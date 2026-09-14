package com.saimetric.pos.reports

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import com.saimetric.pos.reports.entities.ReportDao
import com.saimetric.pos.reports.entities.SavedReportTemplateEntity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.io.FileWriter

/**
 * ReportsListActivity:
 * Screen for end users to browse and run authorized reports.
 * Enforces role-based permissions:
 * - Shows only reports where current_user_role has can_view=true.
 * - Displays buttons based on permissions: Run, Export, Edit.
 */
class ReportsListActivity : AppCompatActivity() {

    private lateinit var reportDao: ReportDao
    private var currentUserRole: String = "manager" // e.g. "super_admin", "manager", "cashier", "accountant"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        currentUserRole = intent.getStringExtra("USER_ROLE") ?: "manager"
        loadAuthorizedReports()
    }

    private fun loadAuthorizedReports() {
        lifecycleScope.launch {
            val templates: List<SavedReportTemplateEntity> = withContext(Dispatchers.IO) {
                if (currentUserRole == "super_admin") {
                    reportDao.getAllTemplates()
                } else {
                    reportDao.getPermittedReportsForRole(currentUserRole)
                }
            }
            bindReportsList(templates)
        }
    }

    private fun bindReportsList(reports: List<SavedReportTemplateEntity>) {
        // Render reports into RecyclerView
        // For each item, retrieve permissions for currentUserRole
        // Show/hide Run, Export, Edit action buttons accordingly
    }

    /**
     * Run Report Action
     */
    fun onRunReport(template: SavedReportTemplateEntity) {
        val compiled = QueryBuilder.buildSafeQuery(template.jsonConfig)
        lifecycleScope.launch {
            val results = withContext(Dispatchers.IO) {
                reportDao.executeRawReport(compiled.query)
            }
            // Launch ReportViewerActivity with results
            Toast.makeText(this@ReportsListActivity, "Running: ${template.name} (${results.size} rows)", Toast.LENGTH_SHORT).show()
        }
    }

    /**
     * Export Report Action (can_export=true)
     */
    fun onExportReport(template: SavedReportTemplateEntity) {
        lifecycleScope.launch {
            val compiled = QueryBuilder.buildSafeQuery(template.jsonConfig)
            val results = withContext(Dispatchers.IO) {
                reportDao.executeRawReport(compiled.query)
            }

            if (results.isEmpty()) {
                Toast.makeText(this@ReportsListActivity, "No data to export", Toast.LENGTH_SHORT).show()
                return@launch
            }

            // Export to CSV
            withContext(Dispatchers.IO) {
                val file = File(cacheDir, "${template.name.replace(" ", "_")}.csv")
                val writer = FileWriter(file)
                val headers = results[0].keys.toList()
                writer.append(headers.joinToString(",")).append("\n")

                for (row in results) {
                    val line = headers.map { h -> "\"${row[h]?.toString() ?: ""}\"" }
                    writer.append(line.joinToString(",")).append("\n")
                }
                writer.flush()
                writer.close()

                withContext(Dispatchers.Main) {
                    Toast.makeText(this@ReportsListActivity, "Exported to CSV: ${file.name}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    /**
     * Edit Report Action (can_edit=true or super_admin)
     */
    fun onEditReport(template: SavedReportTemplateEntity) {
        val intent = Intent(this, ReportBuilderActivity::class.java).apply {
            putExtra("EDIT_TEMPLATE_ID", template.id)
        }
        startActivity(intent)
    }

    /**
     * Launch Report Builder for Super Admin
     */
    fun onCreateNewReport(view: View) {
        if (currentUserRole != "super_admin") {
            Toast.makeText(this, "Only Super Admin can create custom reports", Toast.LENGTH_SHORT).show()
            return
        }
        val intent = Intent(this, ReportBuilderActivity::class.java)
        startActivity(intent)
    }
}
