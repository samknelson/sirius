import PdfPrinter from "pdfmake";
import type { TDocumentDefinitions, TFontDictionary } from "pdfmake/interfaces";

// Define fonts for pdfmake using standard PDF fonts (no external files needed)
const fonts: TFontDictionary = {
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
  Times: {
    normal: "Times-Roman",
    bold: "Times-Bold",
    italics: "Times-Italic",
    bolditalics: "Times-BoldItalic",
  },
  Courier: {
    normal: "Courier",
    bold: "Courier-Bold",
    italics: "Courier-Oblique",
    bolditalics: "Courier-BoldOblique",
  },
};

interface InvoiceEntry {
  id: string;
  date: Date | string | null;
  amount: string;
  memo: string | null;
  entityType: string;
  entityName: string | null;
  referenceName: string | null;
}

interface InvoiceData {
  eaName: string;
  accountName: string;
  invoiceNumber: string;
  month: number;
  year: number;
  incomingBalance: string;
  invoiceBalance: string;
  outgoingBalance: string;
  entries: InvoiceEntry[];
  invoiceHeader?: string | null;
  invoiceFooter?: string | null;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function formatAmount(amount: string): string {
  const num = parseFloat(amount);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(num);
}

function formatDate(date: Date | string | null): string {
  if (!date) return "No date";
  try {
    if (date instanceof Date) {
      return date.toLocaleDateString();
    }
    return new Date(date).toLocaleDateString();
  } catch {
    return "Invalid date";
  }
}

export function generateInvoicePdf(invoiceData: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const monthName = MONTH_NAMES[invoiceData.month - 1];
      
      // Build the table body with entries
      const tableBody: any[][] = [
        // Header row
        [
          { text: "Date", style: "tableHeader" },
          { text: "Amount", style: "tableHeader", alignment: "right" as const },
          { text: "Memo", style: "tableHeader" },
          { text: "Entity Type", style: "tableHeader" },
          { text: "Entity", style: "tableHeader" },
          { text: "Reference", style: "tableHeader" },
        ],
        // Data rows
        ...invoiceData.entries.map((entry) => [
          formatDate(entry.date),
          { text: formatAmount(entry.amount), alignment: "right" as const },
          entry.memo || "-",
          entry.entityType,
          entry.entityName || "-",
          entry.referenceName || "-",
        ]),
      ];

      const content: any[] = [
        // Header
        {
          text: "INVOICE",
          style: "header",
          alignment: "center",
        },
        {
          text: `${monthName} ${invoiceData.year}`,
          style: "subheader",
          alignment: "center",
          margin: [0, 0, 0, 4],
        },
        {
          text: `Invoice No. ${invoiceData.invoiceNumber}`,
          alignment: "center",
          fontSize: 11,
          bold: true,
          margin: [0, 0, 0, 20],
        },
      ];

      // Add invoice header if present
      if (invoiceData.invoiceHeader) {
        content.push({
          text: invoiceData.invoiceHeader,
          style: "invoiceHeaderText",
          margin: [0, 0, 0, 20],
        });
      }

      content.push(
        // EA and Account info
        {
          columns: [
            {
              width: "*",
              stack: [
                { text: "Entity-Account:", style: "label" },
                { text: invoiceData.eaName, style: "value" },
              ],
            },
            {
              width: "*",
              stack: [
                { text: "Account:", style: "label" },
                { text: invoiceData.accountName, style: "value" },
              ],
            },
          ],
          margin: [0, 0, 0, 20],
        },

        // Balance Summary
        {
          text: "Balance Summary",
          style: "sectionHeader",
          margin: [0, 0, 0, 10],
        },
        {
          columns: [
            {
              width: "*",
              stack: [
                { text: "Incoming Balance", style: "label" },
                {
                  text: formatAmount(invoiceData.incomingBalance),
                  style: parseFloat(invoiceData.incomingBalance) < 0 ? "negativeAmount" : "value",
                  bold: true,
                },
              ],
            },
            {
              width: "*",
              stack: [
                { text: "Invoice Balance", style: "label" },
                {
                  text: formatAmount(invoiceData.invoiceBalance),
                  style: parseFloat(invoiceData.invoiceBalance) < 0 ? "negativeAmount" : "value",
                  bold: true,
                },
              ],
            },
            {
              width: "*",
              stack: [
                { text: "Outgoing Balance", style: "label" },
                {
                  text: formatAmount(invoiceData.outgoingBalance),
                  style: parseFloat(invoiceData.outgoingBalance) < 0 ? "negativeAmount" : "value",
                  bold: true,
                },
              ],
            },
          ],
          margin: [0, 0, 0, 20],
        },

        // Ledger Entries Table
        {
          text: "Ledger Entries",
          style: "sectionHeader",
          margin: [0, 0, 0, 10],
        },
        {
          table: {
            headerRows: 1,
            widths: ["auto", "auto", "*", "auto", "auto", "auto"],
            body: tableBody,
          },
          layout: {
            fillColor: (rowIndex: number) => {
              return rowIndex === 0 ? "#f3f4f6" : null;
            },
            hLineWidth: () => 0.5,
            vLineWidth: () => 0.5,
            hLineColor: () => "#e5e7eb",
            vLineColor: () => "#e5e7eb",
          },
        },

        // Footer with entry count
        {
          text: `Total Entries: ${invoiceData.entries.length}`,
          style: "footer",
          margin: [0, 20, 0, 0],
          alignment: "right",
        }
      );

      // Add invoice footer if present
      if (invoiceData.invoiceFooter) {
        content.push({
          text: invoiceData.invoiceFooter,
          style: "invoiceFooterText",
          margin: [0, 20, 0, 0],
        });
      }

      const docDefinition: TDocumentDefinitions = {
        content,
        styles: {
          header: {
            fontSize: 24,
            bold: true,
            margin: [0, 0, 0, 10],
          },
          subheader: {
            fontSize: 16,
            color: "#6b7280",
          },
          sectionHeader: {
            fontSize: 14,
            bold: true,
            color: "#374151",
          },
          label: {
            fontSize: 10,
            color: "#6b7280",
            margin: [0, 0, 0, 2],
          },
          value: {
            fontSize: 12,
            color: "#111827",
          },
          negativeAmount: {
            fontSize: 12,
            color: "#dc2626",
          },
          tableHeader: {
            bold: true,
            fontSize: 10,
            color: "#374151",
          },
          footer: {
            fontSize: 10,
            color: "#6b7280",
            italics: true,
          },
          invoiceHeaderText: {
            fontSize: 10,
            color: "#374151",
            alignment: "left",
          },
          invoiceFooterText: {
            fontSize: 10,
            color: "#374151",
            alignment: "left",
          },
        },
        defaultStyle: {
          fontSize: 10,
          color: "#111827",
          font: "Helvetica",
        },
        pageMargins: [40, 40, 40, 40],
      };

      const printer = new PdfPrinter(fonts);
      const pdfDoc = printer.createPdfKitDocument(docDefinition);
      
      const chunks: Buffer[] = [];
      pdfDoc.on("data", (chunk) => chunks.push(chunk));
      pdfDoc.on("end", () => resolve(Buffer.concat(chunks)));
      pdfDoc.on("error", reject);
      
      pdfDoc.end();
    } catch (error) {
      reject(error);
    }
  });
}
