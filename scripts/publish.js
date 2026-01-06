// import { put } from "@vercel/blob";
// import File from "fs-extra";

// const filename = "thompsonst.pdf";
// const file = File.readFileSync(`./output/${filename}`);
// const blob = await put(filename, file, {
//   access: "public",
//   allowOverwrite: true,
// });

// console.log("Blob URL:", blob.url);

const fs = require("fs");
const path = require("path");
const { S3Client, ListObjectsV2Command } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const mime = require("mime-types");

const region = process.env.AWS_REGION || "ap-southeast-2"; // change default if you want
const bucket = "thompsonst.requisite.link";

async function main() {
  const s3 = new S3Client({ region });
  const filePath = "./output/thompsonst.pdf";
  const absPath = path.resolve(filePath);
  const body = fs.readFileSync(absPath);
  const contentType = mime.lookup(absPath) || "application/octet-stream";

  const date = new Date().toISOString().split("T")[0];
  const key = `thompsonst-booklet-${date}.pdf`;
  await upload(s3, key, body, contentType);
  await upload(s3, `thompsonst-booklet-latest.pdf`, body, contentType);
  await updateIndex(s3);
}

async function upload(s3, key, body, contentType) {
  const uploader = new Upload({
    client: s3,
    params: {
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    },
    queueSize: 4, // concurrency for multipart
    partSize: 10 * 1024 * 1024, // 10MB parts
    leavePartsOnError: false,
  });

  uploader.on("httpUploadProgress", (p) => {
    if (p.total) {
      const pct = ((p.loaded / p.total) * 100).toFixed(1);
      process.stdout.write(`\rUploading: ${pct}% (${p.loaded}/${p.total})`);
    } else {
      process.stdout.write(`\rUploaded: ${p.loaded} bytes`);
    }
  });

  try {
    await uploader.done();
    process.stdout.write("\n");
    console.log(`✅ Uploaded to s3://${bucket}/${key}`);
  } catch (err) {
    process.stdout.write("\n");
    console.error("❌ Upload failed:", err);
    process.exit(1);
  }
}

async function updateIndex(s3) {
  const command = new ListObjectsV2Command({
    Bucket: bucket,
  });
  const response = await s3.send(command);
  console.log("S3 Bucket Contents:", response.Contents);

  const indexLines = [];
  if (response.Contents) {
    const pdfs = response.Contents.filter((obj) =>
      obj.Key.endsWith(".pdf")
    ).sort((a, b) => b.LastModified - a.LastModified);

    for (const pdf of pdfs) {
      const url = `https://thompsonst.requisite.link/${pdf.Key}`;
      const date = pdf.LastModified.toISOString().split("T")[0];
      indexLines.push(`<li><a href="${url}">${pdf.Key} (${date})</a></li>`);
    }
  }

  const indexContent = indexLines.join("\n") + "\n";
  const index = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Thompson St Booklet Downloads</title>
</head>
<body>
  <h1>Thompson St Booklet Downloads</h1>
  <ul>
    ${indexLines.join("\n    ")}
  </ul>
</body>
</html>`;

  upload(s3, "index.html", index, "text/html");

  console.log("✅ published index.html");
}

main();
