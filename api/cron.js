import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";

export default async function handler(req, res) {
    // Standard Supabase configuration from environment variables
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
    
    // Cloudflare R2 credentials from environment variables
    const r2AccountId = process.env.R2_ACCOUNT_ID;
    const r2AccessKeyId = process.env.R2_ACCESS_KEY_ID;
    const r2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const r2BucketName = process.env.R2_BUCKET_NAME || "db-backups";

    if (!supabaseUrl || !supabaseKey) {
        return res.status(500).json({ error: "Missing Supabase configuration (URL or Key)" });
    }

    if (!r2AccountId || !r2AccessKeyId || !r2SecretAccessKey) {
        return res.status(500).json({ error: "Missing Cloudflare R2 configuration (AccountId, AccessKeyId, or SecretAccessKey)" });
    }

    try {
        const supabase = createClient(supabaseUrl, supabaseKey);
        
        // 1. Fetch data from all tables
        const tables = ["carts", "devices", "students", "lessons", "device_loans", "active_lessons"];
        const backupData = {
            timestamp: new Date().toISOString(),
            data: {}
        };

        for (const table of tables) {
            const { data, error } = await supabase.from(table).select("*");
            if (error) {
                throw new Error(`Failed to fetch table ${table}: ${error.message}`);
            }
            backupData.data[table] = data;
        }

        // 2. Initialize Cloudflare R2 client
        const s3 = new S3Client({
            endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: r2AccessKeyId,
                secretAccessKey: r2SecretAccessKey
            },
            region: "auto"
        });

        // 3. Upload backup file to Cloudflare R2
        const dateStr = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
        const fileName = `backup_${dateStr}.json`;
        const uploadParams = {
            Bucket: r2BucketName,
            Key: fileName,
            Body: JSON.stringify(backupData, null, 2),
            ContentType: "application/json"
        };

        await s3.send(new PutObjectCommand(uploadParams));
        console.log(`Backup successfully uploaded to Cloudflare R2: ${fileName}`);

        // 4. Clean up backups older than 30 days in Cloudflare R2 (Retention Policy)
        const listParams = {
            Bucket: r2BucketName
        };
        const listedObjects = await s3.send(new ListObjectsV2Command(listParams));
        
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        let deletedBackupsCount = 0;

        if (listedObjects.Contents) {
            for (const object of listedObjects.Contents) {
                // Standard backup file name format: backup_YYYY-MM-DD.json
                const match = object.Key.match(/backup_(\d{4}-\d{2}-\d{2})\.json/);
                if (match) {
                    const fileDate = new Date(match[1]);
                    if (fileDate < thirtyDaysAgo) {
                        const deleteParams = {
                            Bucket: r2BucketName,
                            Key: object.Key
                        };
                        await s3.send(new DeleteObjectCommand(deleteParams));
                        console.log(`Deleted old Cloudflare backup: ${object.Key}`);
                        deletedBackupsCount++;
                    }
                }
            }
        }

        // 5. Clean up old logs in Supabase event_log (older than 30 days)
        const thirtyDaysAgoIso = thirtyDaysAgo.toISOString();
        const { error: deleteError, count } = await supabase
            .from("event_log")
            .delete({ count: "exact" })
            .lt("created_at", thirtyDaysAgoIso);

        if (deleteError) {
            console.error(`Failed to purge old logs from Supabase: ${deleteError.message}`);
        } else {
            console.log(`Purged ${count} old event log rows from Supabase.`);
        }

        return res.status(200).json({
            success: true,
            message: "Backup, retention cleanup, and log purge completed successfully",
            backupFile: fileName,
            deletedBackupsCount: deletedBackupsCount,
            purgedLogsCount: count || 0
        });

    } catch (err) {
        console.error("Cron handler crashed:", err);
        return res.status(500).json({ error: err.message });
    }
}
