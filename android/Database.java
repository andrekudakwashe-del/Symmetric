package com.saimetric.pos.sync;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.room.*;
import androidx.room.migration.Migration;
import androidx.sqlite.db.SupportSQLiteDatabase;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.List;

public class DatabaseHelper {

    // ==========================================
    // 1. ENTITY: sales
    // ==========================================
    @Entity(tableName = "sales", indices = {@Index("tenant_id"), @Index("branch_id")})
    public static class SaleEntity {
        @PrimaryKey @NonNull @ColumnInfo(name = "uuid") public String uuid;
        @NonNull @ColumnInfo(name = "tenant_id") public String tenantId;
        @NonNull @ColumnInfo(name = "branch_id") public String branchId;
        @NonNull @ColumnInfo(name = "device_id") public String deviceId;
        @ColumnInfo(name = "timestamp") public long timestamp;
        @NonNull @ColumnInfo(name = "sync_status") public String syncStatus; // "pending" | "synced"
        @NonNull @ColumnInfo(name = "hash") public String hash;
        @ColumnInfo(name = "invoice_number") public String invoiceNumber;
        @ColumnInfo(name = "customer_name") public String customerName;
        @ColumnInfo(name = "total_amount") public double totalAmount;
        @ColumnInfo(name = "payment_method") public String paymentMethod;
        @ColumnInfo(name = "staff_id") public String staffId;
        @ColumnInfo(name = "items_json") public String itemsJson;

        public SaleEntity() {}
        public SaleEntity(@NonNull String uuid, @NonNull String tenantId, @NonNull String branchId, @NonNull String deviceId, long timestamp,
                          @NonNull String syncStatus, @NonNull String hash, String invoiceNumber, String customerName, double totalAmount, 
                          String paymentMethod, String staffId, String itemsJson) {
            this.uuid = uuid; this.tenantId = tenantId; this.branchId = branchId; this.deviceId = deviceId; this.timestamp = timestamp;
            this.syncStatus = syncStatus; this.hash = hash; this.invoiceNumber = invoiceNumber; this.customerName = customerName;
            this.totalAmount = totalAmount; this.paymentMethod = paymentMethod; this.staffId = staffId; this.itemsJson = itemsJson;
        }

        public static String calculateHash(String uuid, String deviceId, long timestamp, double totalAmount, String itemsJson) {
            String raw = uuid + ":" + deviceId + ":" + timestamp + ":" + totalAmount + ":" + (itemsJson != null ? itemsJson : "");
            return DatabaseHelper.sha256(raw);
        }
    }

    // ==========================================
    // 2. ENTITY: products
    // ==========================================
    @Entity(tableName = "products", indices = {@Index("tenant_id"), @Index("branch_id")})
    public static class ProductEntity {
        @PrimaryKey @NonNull @ColumnInfo(name = "uuid") public String uuid;
        @NonNull @ColumnInfo(name = "tenant_id") public String tenantId;
        @NonNull @ColumnInfo(name = "branch_id") public String branchId;
        @NonNull @ColumnInfo(name = "device_id") public String deviceId;
        @ColumnInfo(name = "timestamp") public long timestamp;
        @NonNull @ColumnInfo(name = "sync_status") public String syncStatus;
        @NonNull @ColumnInfo(name = "hash") public String hash;
        @ColumnInfo(name = "sku") public String sku;
        @ColumnInfo(name = "name") public String name;
        @ColumnInfo(name = "category") public String category;
        @ColumnInfo(name = "price") public double price;
        @ColumnInfo(name = "stock_quantity") public int stockQuantity;

        public ProductEntity() {}
        public ProductEntity(@NonNull String uuid, @NonNull String tenantId, @NonNull String branchId, @NonNull String deviceId, long timestamp,
                             @NonNull String syncStatus, @NonNull String hash, String sku, String name, String category, double price, int stockQuantity) {
            this.uuid = uuid; this.tenantId = tenantId; this.branchId = branchId; this.deviceId = deviceId; this.timestamp = timestamp;
            this.syncStatus = syncStatus; this.hash = hash; this.sku = sku; this.name = name; this.category = category; this.price = price; this.stockQuantity = stockQuantity;
        }

        public static String calculateHash(String uuid, String deviceId, long timestamp, String sku, double price, int stockQuantity) {
            String raw = uuid + ":" + deviceId + ":" + timestamp + ":" + sku + ":" + price + ":" + stockQuantity;
            return DatabaseHelper.sha256(raw);
        }
    }

    // ==========================================
    // 3. ENTITY: sync_queue
    // ==========================================
    @Entity(tableName = "sync_queue", indices = {@Index("tenant_id"), @Index("branch_id")})
    public static class SyncQueueEntity {
        @PrimaryKey @NonNull @ColumnInfo(name = "record_uuid") public String recordUuid;
        @NonNull @ColumnInfo(name = "tenant_id") public String tenantId;
        @NonNull @ColumnInfo(name = "branch_id") public String branchId;
        @NonNull @ColumnInfo(name = "table_name") public String tableName;
        @NonNull @ColumnInfo(name = "device_id") public String deviceId;
        @ColumnInfo(name = "timestamp") public long timestamp;
        @NonNull @ColumnInfo(name = "hash") public String hash;
        @NonNull @ColumnInfo(name = "payload_json") public String payloadJson;
        @ColumnInfo(name = "retry_count") public int retryCount;

        public SyncQueueEntity() {}
        public SyncQueueEntity(@NonNull String recordUuid, @NonNull String tenantId, @NonNull String branchId,
                               @NonNull String tableName, @NonNull String deviceId, long timestamp,
                               @NonNull String hash, @NonNull String payloadJson, int retryCount) {
            this.recordUuid = recordUuid; this.tenantId = tenantId; this.branchId = branchId;
            this.tableName = tableName; this.deviceId = deviceId; this.timestamp = timestamp;
            this.hash = hash; this.payloadJson = payloadJson; this.retryCount = retryCount;
        }
    }

    // ==========================================
    // DAOs with Strict Tenant & Branch Isolation
    // ==========================================

    @Dao
    public interface SaleDao {
        @Insert(onConflict = OnConflictStrategy.REPLACE)
        void insert(SaleEntity sale);

        @Insert(onConflict = OnConflictStrategy.REPLACE)
        void insertAll(List<SaleEntity> sales);

        @Query("SELECT * FROM sales WHERE tenant_id = :tenantId ORDER BY timestamp DESC")
        List<SaleEntity> getAllForTenant(String tenantId);

        @Query("SELECT * FROM sales WHERE tenant_id = :tenantId AND branch_id = :branchId ORDER BY timestamp DESC")
        List<SaleEntity> getAllForBranch(String tenantId, String branchId);

        @Query("SELECT * FROM sales WHERE uuid = :uuid LIMIT 1")
        SaleEntity getByUuid(String uuid);

        @Query("UPDATE sales SET sync_status = 'synced' WHERE uuid IN (:uuids)")
        void markAsSynced(List<String> uuids);
    }

    @Dao
    public interface ProductDao {
        @Insert(onConflict = OnConflictStrategy.REPLACE)
        void insert(ProductEntity product);

        @Insert(onConflict = OnConflictStrategy.REPLACE)
        void insertAll(List<ProductEntity> products);

        @Query("SELECT * FROM products WHERE tenant_id = :tenantId ORDER BY name ASC")
        List<ProductEntity> getAllForTenant(String tenantId);

        @Query("SELECT * FROM products WHERE tenant_id = :tenantId AND branch_id = :branchId ORDER BY name ASC")
        List<ProductEntity> getAllForBranch(String tenantId, String branchId);

        @Query("SELECT * FROM products WHERE uuid = :uuid LIMIT 1")
        ProductEntity getByUuid(String uuid);

        @Query("UPDATE products SET sync_status = 'synced' WHERE uuid IN (:uuids)")
        void markAsSynced(List<String> uuids);
    }

    @Dao
    public interface SyncQueueDao {
        @Insert(onConflict = OnConflictStrategy.REPLACE)
        void enqueue(SyncQueueEntity queueItem);

        @Insert(onConflict = OnConflictStrategy.REPLACE)
        void enqueueAll(List<SyncQueueEntity> queueItems);

        @Query("SELECT * FROM sync_queue WHERE tenant_id = :tenantId ORDER BY timestamp ASC")
        List<SyncQueueEntity> getPendingForTenant(String tenantId);

        @Query("SELECT * FROM sync_queue WHERE tenant_id = :tenantId AND branch_id = :branchId ORDER BY timestamp ASC")
        List<SyncQueueEntity> getPendingForBranch(String tenantId, String branchId);

        @Query("SELECT * FROM sync_queue ORDER BY timestamp ASC")
        List<SyncQueueEntity> getAllPending();

        @Query("DELETE FROM sync_queue WHERE record_uuid IN (:uuids)")
        void deleteSyncedRecords(List<String> uuids);

        @Query("DELETE FROM sync_queue WHERE record_uuid = :uuid")
        void deleteByUuid(String uuid);
    }

    // ==========================================
    // ROOM DATABASE
    // ==========================================
    @androidx.room.Database(
            entities = {SaleEntity.class, ProductEntity.class, SyncQueueEntity.class},
            version = 2,
            exportSchema = false
    )
    public static abstract class AppDatabase extends RoomDatabase {
        public abstract SaleDao saleDao();
        public abstract ProductDao productDao();
        public abstract SyncQueueDao syncQueueDao();
    }

    private static volatile AppDatabase INSTANCE;

    public static AppDatabase getDatabase(final Context context) {
        if (INSTANCE == null) {
            synchronized (DatabaseHelper.class) {
                if (INSTANCE == null) {
                    INSTANCE = Room.databaseBuilder(context.getApplicationContext(),
                            AppDatabase.class, "saimetric_pos_mesh.db")
                            .fallbackToDestructiveMigration()
                            .build();
                }
            }
        }
        return INSTANCE;
    }

    public static String sha256(String base) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(base.getBytes(StandardCharsets.UTF_8));
            StringBuilder hexString = new StringBuilder();
            for (byte b : hash) {
                String hex = Integer.toHexString(0xff & b);
                if (hex.length() == 1) hexString.append('0');
                hexString.append(hex);
            }
            return hexString.toString();
        } catch (NoSuchAlgorithmException ex) {
            throw new RuntimeException(ex);
        }
    }
}
