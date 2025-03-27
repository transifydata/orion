import AWS from 'aws-sdk';
import zlib from 'zlib';

const s3 = new AWS.S3();

function compressData(data: any): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        zlib.gzip(JSON.stringify(data), (err, encoded) => {
            if (err) reject(err);
            else resolve(encoded);
        });
    });
}

export async function writeToS3(s3Bucket: string, agency: string, currentTime: number, data: any): Promise<AWS.S3.PutObjectOutput> {
    // Used for saving the output of `getVehicles` to S3
    const currentDateTime = new Date(currentTime);
    const year = currentDateTime.getUTCFullYear();
    const month = currentDateTime.getUTCMonth() + 1;
    const day = currentDateTime.getUTCDate();
    const hour = currentDateTime.getUTCHours();
    const minute = currentDateTime.getUTCMinutes();
    const second = currentDateTime.getUTCSeconds();
    const s3Key = `${agency}/${year}/${month}/${day}/${hour}/${minute}/${second}/${agency}-${currentTime}.json.gz`;

    const encodedData = await compressData(data);
    
    const params = {
        Bucket: s3Bucket,
        Key: s3Key,
        Body: encodedData,
        ContentType: "application/json",
        ContentEncoding: "gzip",
    };

    return s3.putObject(params).promise();
}

export async function saveRawBytesToS3(s3Bucket: string, s3Key: string, data: Buffer): Promise<AWS.S3.PutObjectOutput> {
    // Used to save the raw protobuf bytes from the GTFS-realtime feed to S3
    const params = {
        Bucket: s3Bucket,
        Key: s3Key,
        Body: data,
        ContentType: "application/x-protobuf",  // Since this is typically used for GTFS-realtime data
    };

    return s3.putObject(params).promise();
}