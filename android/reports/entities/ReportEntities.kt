package com.saimetric.pos.reports.entities

import androidx.room.*
import androidx.sqlite.db.SimpleSQLiteQuery
import androidx.sqlite.db.SupportSQLiteQuery

// ============================================================================
// ROOM ENTITIES FOR NO-CODE REPORT BUILDER
// ============================================================================

/**
 * 1. Data Dictionary Entity:
 * Defines what tables and columns exist dynamically without hardcoding.
 */
@Entity(tableName = "data_dictionary", indices = [Index(value = ["table_name", "column_name"], unique = true)])
data class DataDictionaryEntity(
    @PrimaryKey
    @ColumnInfo(name = "id")
    val id: String,

    @ColumnInfo(name = "table_name")
    val tableName: String,

    @ColumnInfo(name = "column_name")
    val columnName: String,

    @ColumnInfo(name = "display_name")
    val displayName: String,

    @ColumnInfo(name = "data_type")
    val dataType: String, // "string", "number", "date", "boolean"

    @ColumnInfo(name = "is_filterable")
    val isFilterable: Boolean = true,

    @ColumnInfo(name = "is_groupable")
    val isGroupable: Boolean = true
)

/**
 * 2. Table Relationships Entity:
 * Stores foreign keys and logical relationships to auto-suggest joins.
 */
@Entity(tableName = "table_relationships")
data class TableRelationshipEntity(
    @PrimaryKey
    @ColumnInfo(name = "id")
    val id: String,

    @ColumnInfo(name = "from_table")
    val fromTable: String,

    @ColumnInfo(name = "from_column")
    val fromColumn: String,

    @ColumnInfo(name = "to_table")
    val toTable: String,

    @ColumnInfo(name = "to_column")
    val toColumn: String,

    @ColumnInfo(name = "relationship_name")
    val relationshipName: String
)

/**
 * 3. Saved Report Templates:
 * Persists reports built by Super Admin.
 */
@Entity(tableName = "saved_report_templates")
data class SavedReportTemplateEntity(
    @PrimaryKey
    @ColumnInfo(name = "id")
    val id: String,

    @ColumnInfo(name = "name")
    val name: String,

    @ColumnInfo(name = "description")
    val description: String?,

    @ColumnInfo(name = "json_config")
    val jsonConfig: String, // Full JSON config containing tables, joins, columns, filters, group_by, aggregates

    @ColumnInfo(name = "created_by")
    val createdBy: String,

    @ColumnInfo(name = "created_at")
    val createdAt: String
)

/**
 * 4. User Roles:
 * Seeded with: super_admin, manager, cashier, accountant
 */
@Entity(tableName = "user_roles")
data class UserRoleEntity(
    @PrimaryKey
    @ColumnInfo(name = "id")
    val id: String, // "super_admin", "manager", "cashier", "accountant"

    @ColumnInfo(name = "role_name")
    val roleName: String
)

/**
 * 5. Report Permissions:
 * Role-based access control per saved template.
 */
@Entity(
    tableName = "report_permissions",
    foreignKeys = [
        ForeignKey(
            entity = SavedReportTemplateEntity::class,
            parentColumns = ["id"],
            childColumns = ["report_id"],
            onDelete = ForeignKey.CASCADE
        ),
        ForeignKey(
            entity = UserRoleEntity::class,
            parentColumns = ["id"],
            childColumns = ["role_id"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [
        Index(value = ["report_id", "role_id"], unique = true),
        Index(value = ["role_id"])
    ]
)
data class ReportPermissionEntity(
    @PrimaryKey
    @ColumnInfo(name = "id")
    val id: String,

    @ColumnInfo(name = "report_id")
    val reportId: String,

    @ColumnInfo(name = "role_id")
    val roleId: String,

    @ColumnInfo(name = "can_view")
    val canView: Boolean = false,

    @ColumnInfo(name = "can_edit")
    val canEdit: Boolean = false,

    @ColumnInfo(name = "can_export")
    val canExport: Boolean = false
)

// ============================================================================
// ROOM DATA ACCESS OBJECT (DAO)
// ============================================================================

@Dao
interface ReportDao {

    // --- Data Dictionary ---
    @Query("SELECT * FROM data_dictionary ORDER BY table_name, display_name ASC")
    suspend fun getAllDataDictionary(): List<DataDictionaryEntity>

    @Query("SELECT * FROM data_dictionary WHERE table_name = :tableName")
    suspend fun getColumnsForTable(tableName: String): List<DataDictionaryEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertDataDictionary(items: List<DataDictionaryEntity>)

    // --- Table Relationships ---
    @Query("SELECT * FROM table_relationships")
    suspend fun getAllRelationships(): List<TableRelationshipEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertRelationships(relationships: List<TableRelationshipEntity>)

    // --- Saved Report Templates ---
    @Query("SELECT * FROM saved_report_templates ORDER BY created_at DESC")
    suspend fun getAllTemplates(): List<SavedReportTemplateEntity>

    @Query("SELECT * FROM saved_report_templates WHERE id = :id")
    suspend fun getTemplateById(id: String): SavedReportTemplateEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveTemplate(template: SavedReportTemplateEntity)

    @Query("DELETE FROM saved_report_templates WHERE id = :id")
    suspend fun deleteTemplate(id: String)

    // --- User Roles ---
    @Query("SELECT * FROM user_roles")
    suspend fun getAllRoles(): List<UserRoleEntity>

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertRoles(roles: List<UserRoleEntity>)

    // --- Report Permissions ---
    @Query("SELECT * FROM report_permissions WHERE report_id = :reportId")
    suspend fun getPermissionsForReport(reportId: String): List<ReportPermissionEntity>

    @Query("""
        SELECT t.* FROM saved_report_templates t
        INNER JOIN report_permissions p ON t.id = p.report_id
        WHERE p.role_id = :roleId AND p.can_view = 1
        ORDER BY t.created_at DESC
    """)
    suspend fun getPermittedReportsForRole(roleId: String): List<SavedReportTemplateEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun savePermissions(permissions: List<ReportPermissionEntity>)

    // --- Raw Query Executor with Bind Args (Security Rule 2) ---
    @RawQuery
    suspend fun executeRawReport(query: SupportSQLiteQuery): List<Map<String, Any?>>
}
