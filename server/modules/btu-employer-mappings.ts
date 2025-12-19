import type { Express } from "express";
import { storage } from "../storage";
import { objectStorageService } from "../services/objectStorage";
import { insertFileSchema } from "@shared/schema";
import multer from "multer";
import { parse } from "csv-parse/sync";

const VARIABLE_NAME = "sitespecific_btu_employer_mapping";
const STORAGE_PATH = "sitespecific/btu/config/employer-mappings.csv";

const REQUIRED_HEADERS = [
  "Department ID",
  "Department Title",
  "Location ID",
  "Location Title",
  "Job Code",
  "Job Title",
  "Employer Name",
];

interface CsvValidationResult {
  valid: boolean;
  error?: string;
  rowErrors?: { row: number; field: string; message: string }[];
}

function validateCsvContent(buffer: Buffer): CsvValidationResult {
  try {
    const content = buffer.toString("utf-8");
    
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });

    if (records.length === 0) {
      return { valid: false, error: "CSV file is empty or has no data rows" };
    }

    const actualHeaders = Object.keys(records[0]);
    
    const missingHeaders = REQUIRED_HEADERS.filter(h => !actualHeaders.includes(h));
    if (missingHeaders.length > 0) {
      return { 
        valid: false, 
        error: `Missing required columns: ${missingHeaders.join(", ")}` 
      };
    }

    const extraHeaders = actualHeaders.filter(h => !REQUIRED_HEADERS.includes(h));
    if (extraHeaders.length > 0) {
      return { 
        valid: false, 
        error: `Unexpected columns found: ${extraHeaders.join(", ")}. Only these columns are allowed: ${REQUIRED_HEADERS.join(", ")}` 
      };
    }

    const rowErrors: { row: number; field: string; message: string }[] = [];
    
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      for (const header of REQUIRED_HEADERS) {
        const value = record[header];
        if (value === undefined || value === null || value.toString().trim() === "") {
          rowErrors.push({
            row: i + 2,
            field: header,
            message: `Empty value`,
          });
        }
      }
    }

    if (rowErrors.length > 0) {
      const maxErrors = 5;
      const errorMessages = rowErrors.slice(0, maxErrors).map(
        e => `Row ${e.row}, "${e.field}": ${e.message}`
      );
      const moreCount = rowErrors.length - maxErrors;
      let errorText = errorMessages.join("; ");
      if (moreCount > 0) {
        errorText += `; ... and ${moreCount} more error(s)`;
      }
      return { 
        valid: false, 
        error: `Validation errors: ${errorText}`,
        rowErrors 
      };
    }

    return { valid: true };
  } catch (error) {
    return { 
      valid: false, 
      error: `Failed to parse CSV: ${error instanceof Error ? error.message : "Unknown error"}` 
    };
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are allowed"));
    }
  },
});

export function registerBtuEmployerMappingsRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any
) {
  app.get(
    "/api/btu/employer-mappings",
    requireAuth,
    requirePermission("admin"),
    async (req, res) => {
      try {
        const variable = await storage.variables.getByName(VARIABLE_NAME);
        
        if (!variable || !variable.value) {
          return res.json({ file: null });
        }

        const fileId = variable.value as string;
        const file = await storage.files.getById(fileId);

        if (!file) {
          return res.json({ file: null });
        }

        res.json({ file });
      } catch (error) {
        console.error("Error fetching BTU employer mapping:", error);
        res.status(500).json({ message: "Failed to fetch employer mapping" });
      }
    }
  );

  app.get(
    "/api/btu/employer-mappings/preview",
    requireAuth,
    requirePermission("admin"),
    async (req, res) => {
      try {
        const variable = await storage.variables.getByName(VARIABLE_NAME);
        
        if (!variable || !variable.value) {
          return res.status(404).json({ message: "No file uploaded" });
        }

        const fileId = variable.value as string;
        const file = await storage.files.getById(fileId);

        if (!file) {
          return res.status(404).json({ message: "File not found" });
        }

        const content = await objectStorageService.downloadFile(file.storagePath);
        const csvContent = content.toString("utf-8");

        const lines = csvContent.split("\n").slice(0, 11);
        const preview = lines.join("\n");

        res.json({ preview, totalLines: csvContent.split("\n").length });
      } catch (error) {
        console.error("Error fetching BTU employer mapping preview:", error);
        res.status(500).json({ message: "Failed to fetch preview" });
      }
    }
  );

  app.get(
    "/api/btu/employer-mappings/download",
    requireAuth,
    requirePermission("admin"),
    async (req, res) => {
      try {
        const variable = await storage.variables.getByName(VARIABLE_NAME);
        
        if (!variable || !variable.value) {
          return res.status(404).json({ message: "No file uploaded" });
        }

        const fileId = variable.value as string;
        const file = await storage.files.getById(fileId);

        if (!file) {
          return res.status(404).json({ message: "File not found" });
        }

        const expiresIn = 300;
        const url = await objectStorageService.generateSignedUrl(
          file.storagePath,
          expiresIn
        );

        res.json({ url, fileName: file.fileName });
      } catch (error) {
        console.error("Error generating download URL:", error);
        res.status(500).json({ message: "Failed to generate download URL" });
      }
    }
  );

  app.post(
    "/api/btu/employer-mappings",
    requireAuth,
    requirePermission("admin"),
    upload.single("file"),
    async (req, res) => {
      try {
        const user = req.user as any;
        const replitUserId = user?.claims?.sub;

        if (!replitUserId) {
          return res.status(401).json({ message: "User not authenticated" });
        }

        const dbUser = await storage.users.getUserByReplitId(replitUserId);
        if (!dbUser) {
          return res.status(401).json({ message: "User not found" });
        }

        if (!req.file) {
          return res.status(400).json({ message: "No file provided" });
        }

        const validationResult = validateCsvContent(req.file.buffer);
        if (!validationResult.valid) {
          return res.status(400).json({ 
            message: validationResult.error || "Invalid CSV file"
          });
        }

        const existingVariable = await storage.variables.getByName(VARIABLE_NAME);
        if (existingVariable && existingVariable.value) {
          const oldFileId = existingVariable.value as string;
          const oldFile = await storage.files.getById(oldFileId);
          if (oldFile) {
            try {
              await objectStorageService.deleteFile(oldFile.storagePath);
            } catch (e) {
            }
            await storage.files.delete(oldFileId);
          }
        }

        const uploadResult = await objectStorageService.uploadFile({
          fileName: "employer-mappings.csv",
          fileContent: req.file.buffer,
          mimeType: "text/csv",
          accessLevel: "private",
          customPath: STORAGE_PATH,
        });

        const fileData = {
          fileName: req.file.originalname,
          storagePath: uploadResult.storagePath,
          mimeType: "text/csv",
          size: uploadResult.size,
          uploadedBy: dbUser.id,
          entityType: "btu-config",
          entityId: null,
          accessLevel: "private",
          metadata: {},
        };

        const validatedFileData = insertFileSchema.parse(fileData);
        const file = await storage.files.create(validatedFileData);

        if (existingVariable) {
          await storage.variables.update(existingVariable.id, {
            value: file.id,
          });
        } else {
          await storage.variables.create({
            name: VARIABLE_NAME,
            value: file.id,
          });
        }

        res.status(201).json({ file });
      } catch (error) {
        console.error("Error uploading BTU employer mapping:", error);
        res.status(500).json({ message: "Failed to upload file" });
      }
    }
  );

  app.delete(
    "/api/btu/employer-mappings",
    requireAuth,
    requirePermission("admin"),
    async (req, res) => {
      try {
        const variable = await storage.variables.getByName(VARIABLE_NAME);
        
        if (!variable || !variable.value) {
          return res.status(404).json({ message: "No file to delete" });
        }

        const fileId = variable.value as string;
        const file = await storage.files.getById(fileId);

        if (file) {
          try {
            await objectStorageService.deleteFile(file.storagePath);
          } catch (e) {
          }
          await storage.files.delete(fileId);
        }

        await storage.variables.delete(variable.id);

        res.json({ success: true });
      } catch (error) {
        console.error("Error deleting BTU employer mapping:", error);
        res.status(500).json({ message: "Failed to delete file" });
      }
    }
  );
}
