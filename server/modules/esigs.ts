import type { Express } from "express";
import type { IStorage } from "../storage/database";
import { insertEsigSchema, insertFileSchema } from "@shared/schema";
import { objectStorageService } from "../services/objectStorage";
import multer from "multer";
import officeParser from "officeparser";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB limit for documents
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF and Word documents are allowed"));
    }
  },
});

function validateFileSignature(buffer: Buffer): { valid: boolean; detectedType: string | null } {
  if (buffer.length < 8) {
    return { valid: false, detectedType: null };
  }
  
  // PDF magic bytes: %PDF
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return { valid: true, detectedType: "pdf" };
  }
  
  // DOCX/Office Open XML: PK (ZIP signature) - DOCX files are ZIP archives
  if (buffer[0] === 0x50 && buffer[1] === 0x4B) {
    // Check for Office Open XML by looking for specific patterns
    // DOCX starts with PK and contains [Content_Types].xml
    return { valid: true, detectedType: "docx" };
  }
  
  // DOC (OLE Compound Document): D0 CF 11 E0 A1 B1 1A E1
  if (buffer[0] === 0xD0 && buffer[1] === 0xCF && buffer[2] === 0x11 && buffer[3] === 0xE0 &&
      buffer[4] === 0xA1 && buffer[5] === 0xB1 && buffer[6] === 0x1A && buffer[7] === 0xE1) {
    return { valid: true, detectedType: "doc" };
  }
  
  return { valid: false, detectedType: null };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function textToHtml(text: string): string {
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
  if (paragraphs.length === 0) {
    return "<p>" + escapeHtml(text) + "</p>";
  }
  return paragraphs
    .map(p => "<p>" + escapeHtml(p.trim()).replace(/\n/g, "<br>") + "</p>")
    .join("\n");
}

export function registerEsigsRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any,
  storage: IStorage
) {
  app.post("/api/esigs", requireAuth, async (req, res) => {
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

      const body = { ...req.body, userId: dbUser.id };
      
      if (body.signedDate && typeof body.signedDate === "string") {
        body.signedDate = new Date(body.signedDate);
      }
      
      const parsed = insertEsigSchema.safeParse(body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid esig data", errors: parsed.error.errors });
      }
      
      const esig = await storage.esigs.createEsig(parsed.data);
      res.status(201).json(esig);
    } catch (error: any) {
      console.error("Failed to create esig:", error);
      res.status(500).json({ message: "Failed to create esig" });
    }
  });

  app.post("/api/esigs/upload-document", requireAuth, requirePermission("workers.manage"), upload.single("file"), async (req, res) => {
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

      // Server-side file signature validation (magic bytes)
      const fileValidation = validateFileSignature(req.file.buffer);
      if (!fileValidation.valid) {
        return res.status(400).json({ 
          message: "Invalid file type. The file content does not match a valid PDF or Word document." 
        });
      }

      // Extract text from document using officeparser
      let extractedText: string;
      try {
        extractedText = await officeParser.parseOfficeAsync(req.file.buffer);
      } catch (parseError) {
        console.error("Failed to parse document:", parseError);
        return res.status(400).json({ message: "Failed to extract text from document. Please ensure the file is a valid PDF or Word document." });
      }

      if (!extractedText || extractedText.trim().length === 0) {
        return res.status(400).json({ message: "No text content could be extracted from the document." });
      }

      // Convert extracted text to HTML
      const docRender = textToHtml(extractedText);

      // Upload to object storage in "esigs" folder
      const uploadResult = await objectStorageService.uploadFile({
        fileName: req.file.originalname,
        fileContent: req.file.buffer,
        mimeType: req.file.mimetype,
        accessLevel: "private",
        customPath: `private/esigs/${Date.now()}-${req.file.originalname}`,
      });

      // Create file record in files table
      const fileData = {
        fileName: req.file.originalname,
        storagePath: uploadResult.storagePath,
        mimeType: req.file.mimetype,
        size: uploadResult.size,
        uploadedBy: dbUser.id,
        entityType: "esig",
        entityId: null,
        accessLevel: "private",
        metadata: { extractedTextLength: extractedText.length },
      };

      const validatedFileData = insertFileSchema.parse(fileData);
      const file = await storage.files.create(validatedFileData);

      res.status(201).json({
        fileId: file.id,
        fileName: file.fileName,
        docRender,
      });
    } catch (error: any) {
      console.error("Failed to upload document:", error);
      res.status(500).json({ message: error.message || "Failed to upload document" });
    }
  });

  app.get("/api/esigs/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const esig = await storage.esigs.getEsigById(id);
      
      if (!esig) {
        return res.status(404).json({ message: "E-signature not found" });
      }
      
      res.json(esig);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch esig" });
    }
  });

  app.post("/api/cardcheck/:id/sign", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id: cardcheckId } = req.params;
      const user = req.user as any;
      const replitUserId = user?.claims?.sub;
      
      if (!replitUserId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const dbUser = await storage.users.getUserByReplitId(replitUserId);
      if (!dbUser) {
        return res.status(401).json({ message: "User not found" });
      }

      const existingCardcheck = await storage.cardchecks.getCardcheckById(cardcheckId);
      if (!existingCardcheck) {
        return res.status(404).json({ message: "Cardcheck not found" });
      }

      if (existingCardcheck.status === "signed") {
        return res.status(400).json({ message: "Cardcheck is already signed" });
      }

      if (existingCardcheck.status === "revoked") {
        return res.status(400).json({ message: "Cannot sign a revoked cardcheck" });
      }

      const { docRender, esigData, signatureType, docType = "cardcheck" } = req.body;

      if (!docRender || !esigData) {
        return res.status(400).json({ message: "Missing required signing data" });
      }

      // Extract fileId from esigData if signing with uploaded document
      const fileId = signatureType === "upload" && esigData?.value ? esigData.value : undefined;

      const result = await storage.esigs.signCardcheck({
        cardcheckId,
        userId: dbUser.id,
        docRender,
        docType,
        esigData,
        signatureType,
        fileId,
      });

      res.json(result);
    } catch (error: any) {
      console.error("Failed to sign cardcheck:", error);
      res.status(500).json({ message: "Failed to sign cardcheck" });
    }
  });
}
