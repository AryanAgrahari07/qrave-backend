#!/usr/bin/env node

/**
 * SIMPLIFIED Logo Upload Script
 * 
 * Just edit the CONFIG section below and run!
 * 
 * Usage: node simple-upload.js
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================
// ⚙️  EDIT THIS SECTION WITH YOUR VALUES
// ============================================
const CONFIG = {
  
  // Path to your logos folder
  // Examples:
  //   "./my-logos"
  //   "/Users/john/Desktop/logos"
  //   "C:\\Users\\John\\Desktop\\logos"
  LOGOS_FOLDER: "./logos",
};
// ============================================

// Validate configuration
if (
  CONFIG.AWS_ACCESS_KEY_ID === "YOUR_ACCESS_KEY_HERE" ||
  CONFIG.AWS_SECRET_ACCESS_KEY === "YOUR_SECRET_KEY_HERE" ||
  CONFIG.S3_BUCKET_NAME === "your-bucket-name"
) {
  console.error("\n❌ Please edit the CONFIG section in this file first!\n");
  console.log("Open this file in a text editor and update:");
  console.log("  - AWS_ACCESS_KEY_ID");
  console.log("  - AWS_SECRET_ACCESS_KEY");
  console.log("  - S3_BUCKET_NAME");
  console.log("  - LOGOS_FOLDER\n");
  process.exit(1);
}

const s3Client = new S3Client({
  region: CONFIG.AWS_REGION,
  credentials: {
    accessKeyId: CONFIG.AWS_ACCESS_KEY_ID,
    secretAccessKey: CONFIG.AWS_SECRET_ACCESS_KEY,
  },
});

function getContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ext === '.png' ? 'image/png' : 'image/jpeg';
}

async function uploadFile(filePath, s3Key) {
  try {
    const fileContent = fs.readFileSync(filePath);
    const command = new PutObjectCommand({
      Bucket: CONFIG.S3_BUCKET_NAME,
      Key: s3Key,
      Body: fileContent,
      ContentType: getContentType(filePath),
      CacheControl: "public, max-age=31536000",
      ACL: "public-read",
    });

    await s3Client.send(command);
    return { success: true, key: s3Key };
  } catch (error) {
    return { success: false, key: s3Key, error: error.message };
  }
}

function getImageFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    throw new Error(`Folder not found: ${dirPath}`);
  }

  const files = fs.readdirSync(dirPath);
  return files
    .filter(file => /\.(png|jpg|jpeg)$/i.test(file))
    .map(file => ({
      name: file,
      fullPath: path.join(dirPath, file),
    }));
}

function organizeLogoPairs(files) {
  const pairs = {};
  
  files.forEach(file => {
    const basename = path.basename(file.name, path.extname(file.name));
    
    if (basename.endsWith('-thumb')) {
      const logoId = basename.replace(/-thumb$/, '');
      if (!pairs[logoId]) pairs[logoId] = {};
      pairs[logoId].thumb = file;
    } else {
      if (!pairs[basename]) pairs[basename] = {};
      pairs[basename].full = file;
    }
  });

  return pairs;
}

async function main() {
  console.log("\n🚀 Simple Logo Upload");
  console.log("=".repeat(60));
  console.log(`Folder: ${CONFIG.LOGOS_FOLDER}`);
  console.log(`Bucket: ${CONFIG.S3_BUCKET_NAME}`);
  console.log(`Region: ${CONFIG.AWS_REGION}\n`);

  try {
    const files = getImageFiles(CONFIG.LOGOS_FOLDER);
    console.log(`Found ${files.length} image files\n`);

    const pairs = organizeLogoPairs(files);
    console.log(`Organized into ${Object.keys(pairs).length} logo sets\n`);

    console.log("📋 Will upload:");
    let totalFiles = 0;
    Object.entries(pairs).forEach(([logoId, files]) => {
      if (files.full) {
        console.log(`  ✓ ${logoId}.png (full)`);
        totalFiles++;
      }
      if (files.thumb) {
        console.log(`  ✓ ${logoId}-thumb.png (thumbnail)`);
        totalFiles++;
      }
    });

    console.log(`\n⚠️  Will upload ${totalFiles} files to S3`);
    console.log("Press Ctrl+C to cancel, or wait 3 seconds...\n");
    
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log("📤 Uploading...\n");
    const results = [];
    let count = 0;

    for (const [logoId, files] of Object.entries(pairs)) {
      if (files.full) {
        count++;
        const ext = path.extname(files.full.name);
        const s3Key = `logos/templates/${logoId}${ext}`;
        process.stdout.write(`[${count}/${totalFiles}] ${s3Key}...`);
        const result = await uploadFile(files.full.fullPath, s3Key);
        results.push(result);
        console.log(result.success ? " ✓" : ` ✗ ${result.error}`);
      }

      if (files.thumb) {
        count++;
        const ext = path.extname(files.thumb.name);
        const s3Key = `logos/templates/${logoId}-thumb${ext}`;
        process.stdout.write(`[${count}/${totalFiles}] ${s3Key}...`);
        const result = await uploadFile(files.thumb.fullPath, s3Key);
        results.push(result);
        console.log(result.success ? " ✓" : ` ✗ ${result.error}`);
      }
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log("\n" + "=".repeat(60));
    console.log(`✓ Success: ${successful}`);
    console.log(`✗ Failed: ${failed}`);
    console.log("=".repeat(60) + "\n");

    process.exit(failed > 0 ? 1 : 0);

  } catch (error) {
    console.error("\n❌ Error:", error.message);
    process.exit(1);
  }
}

main();