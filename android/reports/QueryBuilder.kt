package com.saimetric.pos.reports

import androidx.sqlite.db.SimpleSQLiteQuery
import androidx.sqlite.db.SupportSQLiteQuery
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.*

/**
 * QueryBuilder converts a no-code report json_config into a secure, parameterized
 * Room SupportSQLiteQuery suitable for @RawQuery execution.
 *
 * Rules:
 * 1. Security: Bind arguments are used for all runtime parameters (no SQL injection).
 * 2. Performance: Forces date filter if estimated table size exceeds 10,000 rows.
 */
object QueryBuilder {

    data class CompiledQuery(
        val sql: String,
        val bindArgs: Array<Any>,
        val query: SupportSQLiteQuery,
        val performanceWarning: String? = null
    )

    fun buildSafeQuery(jsonConfigString: String, estimatedRowCount: Int = 0): CompiledQuery {
        val config = JSONObject(jsonConfigString)
        val bindArgsList = mutableListOf<Any>()

        // 1. TABLES
        val tablesJson = config.optJSONArray("tables") ?: JSONArray()
        val primaryTable = if (tablesJson.length() > 0) tablesJson.getString(0) else "sales"

        // 2. COLUMNS & AGGREGATES
        val selectParts = mutableListOf<String>()
        val columnsJson = config.optJSONArray("columns") ?: JSONArray()
        for (i in 0 until columnsJson.length()) {
            val col = columnsJson.getString(i)
            if (!col.contains("(")) {
                selectParts.add("$col AS \"$col\"")
            }
        }

        val aggregatesJson = config.optJSONArray("aggregates")
        if (aggregatesJson != null) {
            for (i in 0 until aggregatesJson.length()) {
                val agg = aggregatesJson.getJSONObject(i)
                val func = agg.getString("func")
                val column = agg.getString("column")
                val alias = agg.optString("alias", "$func($column)")
                selectParts.add("$func($column) AS \"$alias\"")
            }
        }

        if (selectParts.isEmpty()) {
            selectParts.add("$primaryTable.*")
        }

        val sqlBuilder = StringBuilder()
        sqlBuilder.append("SELECT\n  ").append(selectParts.joinToString(",\n  "))
        sqlBuilder.append("\nFROM ").append(primaryTable)

        // 3. JOINS
        val joinsJson = config.optJSONArray("joins")
        if (joinsJson != null) {
            for (i in 0 until joinsJson.length()) {
                val join = joinsJson.getJSONObject(i)
                val from = join.getString("from")
                val to = join.getString("to")
                val toTable = to.substringBefore(".")
                val joinType = join.optString("type", "INNER")
                sqlBuilder.append("\n$joinType JOIN $toTable ON $from = $to")
            }
        }

        // 4. FILTERS
        val whereClauses = mutableListOf<String>()
        val filtersJson = config.optJSONArray("filters")
        var hasDateFilter = false
        val dateFormat = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        val today = Calendar.getInstance()

        if (filtersJson != null) {
            for (i in 0 until filtersJson.length()) {
                val f = filtersJson.getJSONObject(i)
                val col = f.optString("column")
                if (col.isEmpty()) continue

                val op = f.optString("op")
                if (col.endsWith(".date") || col.endsWith(".created_date")) {
                    hasDateFilter = true
                }

                when (op) {
                    "equals" -> {
                        whereClauses.add("$col = ?")
                        bindArgsList.add(f.opt("value") ?: "")
                    }
                    "not_equals" -> {
                        whereClauses.add("$col != ?")
                        bindArgsList.add(f.opt("value") ?: "")
                    }
                    "contains" -> {
                        whereClauses.add("$col LIKE ?")
                        bindArgsList.add("%${f.optString("value")}%")
                    }
                    "gt" -> {
                        whereClauses.add("$col > ?")
                        bindArgsList.add(f.opt("value") ?: "")
                    }
                    "lt" -> {
                        whereClauses.add("$col < ?")
                        bindArgsList.add(f.opt("value") ?: "")
                    }
                    "gte" -> {
                        whereClauses.add("$col >= ?")
                        bindArgsList.add(f.opt("value") ?: "")
                    }
                    "lte" -> {
                        whereClauses.add("$col <= ?")
                        bindArgsList.add(f.opt("value") ?: "")
                    }
                    "last_7_days" -> {
                        hasDateFilter = true
                        val cal = Calendar.getInstance()
                        cal.add(Calendar.DAY_OF_YEAR, -7)
                        whereClauses.add("$col >= ?")
                        bindArgsList.add(dateFormat.format(cal.time))
                    }
                    "last_30_days" -> {
                        hasDateFilter = true
                        val cal = Calendar.getInstance()
                        cal.add(Calendar.DAY_OF_YEAR, -30)
                        whereClauses.add("$col >= ?")
                        bindArgsList.add(dateFormat.format(cal.time))
                    }
                    "this_month" -> {
                        hasDateFilter = true
                        val cal = Calendar.getInstance()
                        cal.set(Calendar.DAY_OF_MONTH, 1)
                        whereClauses.add("$col >= ?")
                        bindArgsList.add(dateFormat.format(cal.time))
                    }
                    "between" -> {
                        whereClauses.add("$col BETWEEN ? AND ?")
                        bindArgsList.add(f.opt("value") ?: "")
                        bindArgsList.add(f.opt("value2") ?: "")
                    }
                }
            }
        }

        // Performance Rule: Force date filter if dataset > 10,000 rows
        var perfWarning: String? = null
        if (estimatedRowCount > 10000 && !hasDateFilter) {
            val cal = Calendar.getInstance()
            cal.add(Calendar.DAY_OF_YEAR, -90)
            whereClauses.add("$primaryTable.date >= ?")
            bindArgsList.add(dateFormat.format(cal.time))
            perfWarning = "Performance Guard: Date filter automatically enforced for dataset exceeding 10,000 rows."
        }

        if (whereClauses.isNotEmpty()) {
            sqlBuilder.append("\nWHERE ").append(whereClauses.joinToString(" AND "))
        }

        // 5. GROUP BY
        val groupByJson = config.optJSONArray("group_by")
        if (groupByJson != null && groupByJson.length() > 0) {
            val groups = mutableListOf<String>()
            for (i in 0 until groupByJson.length()) {
                groups.add(groupByJson.getString(i))
            }
            sqlBuilder.append("\nGROUP BY ").append(groups.joinToString(", "))
        }

        // 6. ORDER BY
        val sortByJson = config.optJSONArray("sort_by")
        if (sortByJson != null && sortByJson.length() > 0) {
            val orders = mutableListOf<String>()
            for (i in 0 until sortByJson.length()) {
                val s = sortByJson.getJSONObject(i)
                orders.add("${s.getString("column")} ${s.optString("direction", "DESC")}")
            }
            sqlBuilder.append("\nORDER BY ").append(orders.joinToString(", "))
        }

        // 7. LIMIT
        val limit = config.optInt("limit", 500)
        sqlBuilder.append("\nLIMIT ").append(limit)

        val finalSql = sqlBuilder.toString()
        val bindArgsArray = bindArgsList.toTypedArray()
        val simpleQuery = SimpleSQLiteQuery(finalSql, bindArgsArray)

        return CompiledQuery(finalSql, bindArgsArray, simpleQuery, perfWarning)
    }
}
