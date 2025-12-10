const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
const publicPaths = process.env.PUBLIC_OBJECT_SEARCH_PATHS?.split(',') || ['public'];
const privateDir = process.env.PRIVATE_OBJECT_DIR || '.private';

export class ObjectStorageNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ObjectStorageNotConfiguredError';
  }
}

export class ObjectStorageConnectionError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'ObjectStorageConnectionError';
  }
}

function ensureBucketId(): string {
  if (!bucketId) {
    throw new ObjectStorageNotConfiguredError(
      'Object Storage is not configured. Please open the "Object Storage" tool in your Replit workspace and create a storage bucket, then set the DEFAULT_OBJECT_STORAGE_BUCKET_ID environment variable.'
    );
  }
  return bucketId;
}

async function checkStorageServiceAvailable(): Promise<{ available: boolean; error?: string }> {
  try {
    const response = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      return { available: true };
    }
    return { 
      available: false, 
      error: `Storage service returned status ${response.status}` 
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError' || error.message.includes('timeout')) {
        return { 
          available: false, 
          error: 'Storage service connection timed out' 
        };
      }
      if (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed')) {
        return { 
          available: false, 
          error: 'Cannot connect to storage service - the Replit storage sidecar is not running' 
        };
      }
    }
    return { 
      available: false, 
      error: 'Storage service is unavailable' 
    };
  }
}

export interface UploadFileOptions {
  fileName: string;
  fileContent: Buffer;
  mimeType?: string;
  accessLevel: 'public' | 'private';
  customPath?: string;
}

export interface FileMetadata {
  fileName: string;
  storagePath: string;
  size: number;
  mimeType?: string;
  lastModified?: Date;
}

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return { bucketName, objectName };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  
  let response: Response;
  try {
    response = await fetch(
      `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(10000),
      }
    );
  } catch (error) {
    const serviceCheck = await checkStorageServiceAvailable();
    if (!serviceCheck.available) {
      throw new ObjectStorageConnectionError(
        `Object Storage is not available: ${serviceCheck.error}. ` +
        `Please ensure Object Storage is configured in your Replit workspace by opening the "Object Storage" tool in the sidebar.`
      );
    }
    throw new ObjectStorageConnectionError(
      `Failed to connect to Object Storage service: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
  
  if (!response.ok) {
    let errorDetails = '';
    try {
      const errorBody = await response.text();
      if (errorBody) {
        errorDetails = `: ${errorBody}`;
      }
    } catch {}
    
    if (response.status === 401) {
      throw new ObjectStorageConnectionError(
        `Object Storage authentication failed. The storage bucket "${bucketName}" may not exist or is not accessible. ` +
        `Please open the "Object Storage" tool in your Replit workspace and verify that a bucket named "${bucketName}" exists and is properly configured.`,
        401
      );
    }
    
    if (response.status === 404) {
      throw new ObjectStorageConnectionError(
        `Object Storage bucket "${bucketName}" was not found. ` +
        `Please open the "Object Storage" tool in your Replit workspace and create a bucket, then update the DEFAULT_OBJECT_STORAGE_BUCKET_ID environment variable.`,
        404
      );
    }
    
    if (response.status >= 500) {
      throw new ObjectStorageConnectionError(
        `Object Storage service error (${response.status}). This may be a temporary issue with Replit's storage infrastructure. Please try again in a few moments.`,
        response.status
      );
    }
    
    throw new ObjectStorageConnectionError(
      `Object Storage request failed with status ${response.status}${errorDetails}`,
      response.status
    );
  }

  const { signed_url: signedURL } = await response.json();
  return signedURL;
}

export class ObjectStorageService {
  async uploadFile(options: UploadFileOptions): Promise<{ storagePath: string; size: number }> {
    const { fileName, fileContent, mimeType, accessLevel, customPath } = options;

    const directory = accessLevel === 'public' ? publicPaths[0] : privateDir;
    const storagePath = customPath || `${directory}/${Date.now()}-${fileName}`;

    // Get signed URL for upload
    const fullPath = `/${ensureBucketId()}/${storagePath}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    
    const signedUrl = await signObjectURL({
      bucketName,
      objectName,
      method: 'PUT',
      ttlSec: 900, // 15 minutes
    });

    // Upload file using signed URL
    const uploadResponse = await fetch(signedUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': mimeType || 'application/octet-stream',
      },
      body: fileContent,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Failed to upload file: ${uploadResponse.status} ${uploadResponse.statusText}`);
    }

    return {
      storagePath,
      size: fileContent.length,
    };
  }

  async downloadFile(storagePath: string): Promise<Buffer> {
    const fullPath = `/${ensureBucketId()}/${storagePath}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);

    const signedUrl = await signObjectURL({
      bucketName,
      objectName,
      method: 'GET',
      ttlSec: 900,
    });

    const response = await fetch(signedUrl);
    
    if (!response.ok) {
      throw new Error('File not found or empty');
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async deleteFile(storagePath: string): Promise<void> {
    const fullPath = `/${ensureBucketId()}/${storagePath}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);

    const signedUrl = await signObjectURL({
      bucketName,
      objectName,
      method: 'DELETE',
      ttlSec: 900,
    });

    const response = await fetch(signedUrl, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error(`Failed to delete file: ${response.status} ${response.statusText}`);
    }
  }

  async getFileMetadata(storagePath: string): Promise<FileMetadata> {
    const fullPath = `/${ensureBucketId()}/${storagePath}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);

    const signedUrl = await signObjectURL({
      bucketName,
      objectName,
      method: 'HEAD',
      ttlSec: 900,
    });

    const response = await fetch(signedUrl, {
      method: 'HEAD',
    });

    if (!response.ok) {
      throw new Error('File not found');
    }

    const contentLength = response.headers.get('content-length');
    const contentType = response.headers.get('content-type');
    const lastModified = response.headers.get('last-modified');

    return {
      fileName: storagePath.split('/').pop() || storagePath,
      storagePath,
      size: contentLength ? parseInt(contentLength) : 0,
      mimeType: contentType || undefined,
      lastModified: lastModified ? new Date(lastModified) : undefined,
    };
  }

  async generateSignedUrl(storagePath: string, expiresIn: number = 3600): Promise<string> {
    const fullPath = `/${ensureBucketId()}/${storagePath}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);

    return await signObjectURL({
      bucketName,
      objectName,
      method: "GET",
      ttlSec: expiresIn,
    });
  }

  async listFiles(prefix?: string): Promise<FileMetadata[]> {
    // Note: Listing files requires database metadata tracking
    // since Replit's sidecar doesn't provide a list endpoint
    // This method should be implemented using the files table
    throw new Error('File listing requires database metadata tracking - use storage.files.list() instead');
  }

  async fileExists(storagePath: string): Promise<boolean> {
    try {
      await this.getFileMetadata(storagePath);
      return true;
    } catch (error) {
      return false;
    }
  }
}

export const objectStorageService = new ObjectStorageService();
