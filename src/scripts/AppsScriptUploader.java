package com.saimetric.pos.sync;

import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;

public class AppsScriptUploader {
    private static final String TAG = "AppsScriptUploader";
    // USE YOUR CURRENT DEPLOYED URL HERE
    private static final String APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxxxxxxxxx/exec";

    public static boolean uploadBatch(List<DatabaseHelper.SyncQueueEntity> batch) {
        if(batch.isEmpty()) return true;
        
        try {
            URL url = new URL(APPS_SCRIPT_URL);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");

            JSONArray records = new JSONArray();
            for(DatabaseHelper.SyncQueueEntity item : batch){
                JSONObject record = new JSONObject(item.payloadJson);
                record.put("company_id", item.tenantId);
                record.put("branch_id", item.branchId);
                record.put("uuid", item.recordUuid);
                records.put(record);
            }

            JSONObject payload = new JSONObject();
            payload.put("action", "INSERT"); // This will hit your handleGenericInsert
            payload.put("sheet", "Sales");
            payload.put("company_id", batch.get(0).tenantId);
            payload.put("branch_id", batch.get(0).branchId);
            payload.put("data", records);

            OutputStream os = conn.getOutputStream();
            os.write(payload.toString().getBytes("UTF-8"));
            os.close();

            int responseCode = conn.getResponseCode();
            if(responseCode == 200){
                BufferedReader in = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                String response = in.readLine();
                in.close();
                JSONObject res = new JSONObject(response);
                Log.i(TAG, "Upload success: " + res.toString());
                return res.optBoolean("success", false);
            }
        } catch(Exception e){
            Log.e(TAG, "Upload failed: " + e.getMessage(), e);
        }
        return false;
    }
}
