package com.saimetric.pos.reports

import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.saimetric.pos.reports.entities.ReportDao
import com.saimetric.pos.reports.entities.ReportPermissionEntity
import com.saimetric.pos.reports.entities.UserRoleEntity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.*

/**
 * ReportPermissionsActivity:
 * Screen for Super Admin to configure and assign role permissions for a report template.
 *
 * Roles: super_admin, manager, cashier, accountant
 * Permissions per role: can_view, can_edit, can_export
 */
class ReportPermissionsActivity : AppCompatActivity() {

    private lateinit var reportDao: ReportDao
    private var reportId: String = ""
    private var reportName: String = ""

    private var availableRoles: List<UserRoleEntity> = emptyList()
    private val currentPermissions = mutableMapOf<String, ReportPermissionEntity>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        reportId = intent.getStringExtra("REPORT_ID") ?: ""
        reportName = intent.getStringExtra("REPORT_NAME") ?: "Report"

        if (reportId.isEmpty()) {
            finish()
            return
        }

        loadPermissions()
    }

    private fun loadPermissions() {
        lifecycleScope.launch {
            availableRoles = withContext(Dispatchers.IO) { reportDao.getAllRoles() }
            val existing = withContext(Dispatchers.IO) { reportDao.getPermissionsForReport(reportId) }
            existing.forEach { currentPermissions[it.roleId] = it }

            // Default roles if missing
            availableRoles.forEach { role ->
                if (!currentPermissions.containsKey(role.id)) {
                    val isSuper = role.id == "super_admin"
                    currentPermissions[role.id] = ReportPermissionEntity(
                        id = "perm_${UUID.randomUUID()}",
                        reportId = reportId,
                        roleId = role.id,
                        canView = isSuper,
                        canEdit = isSuper,
                        canExport = isSuper
                    )
                }
            }
            bindRoleCheckboxes()
        }
    }

    private fun bindRoleCheckboxes() {
        // Render UI table of roles with checkboxes for can_view, can_edit, can_export
    }

    fun updatePermission(roleId: String, canView: Boolean, canEdit: Boolean, canExport: Boolean) {
        if (roleId == "super_admin") return // Super admin permissions cannot be revoked

        val existing = currentPermissions[roleId]
        if (existing != null) {
            currentPermissions[roleId] = existing.copy(
                canView = canView,
                canEdit = if (canView) canEdit else false,
                canExport = if (canView) canExport else false
            )
        }
    }

    fun onSavePermissions() {
        lifecycleScope.launch(Dispatchers.IO) {
            val list = currentPermissions.values.toList()
            reportDao.savePermissions(list)
            withContext(Dispatchers.Main) {
                Toast.makeText(this@ReportPermissionsActivity, "Role permissions updated for $reportName", Toast.LENGTH_SHORT).show()
                finish()
            }
        }
    }
}
