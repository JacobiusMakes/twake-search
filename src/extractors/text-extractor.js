/**
 * Document Text Extraction
 *
 * Extracts searchable plain text from various file formats.
 * Supports: plain text, PDF, DOCX
 *
 * Each extractor takes a Buffer and returns a string of extracted text.
 * Failed extractions return empty string (non-fatal) with a warning log.
 */

import { readFileSync } from 'fs';

/**
 * Extract text from a file buffer based on MIME type.
 *
 * @param {Buffer} buffer - File content
 * @param {string} mimeType - MIME type (e.g., "application/pdf")
 * @param {string} [fileName] - Optional filename for fallback type detection
 * @returns {Promise<string>} Extracted text
 */
export async function extractText(buffer, mimeType, fileName = '') {
  const type = detectType(mimeType, fileName);

  switch (type) {
    case 'text':
      return extractPlainText(buffer);
    case 'pdf':
      return extractPdf(buffer);
    case 'docx':
      return extractDocx(buffer);
    default:
      // Unsupported format — return empty (file metadata is still indexed)
      return '';
  }
}

/**
 * Detect document type from MIME type or filename extension.
 */
function detectType(mimeType, fileName) {
  const mime = (mimeType || '').toLowerCase();
  const ext = fileName.split('.').pop()?.toLowerCase();

  // Plain text
  if (mime.startsWith('text/') || ['txt', 'md', 'csv', 'log', 'json', 'xml', 'yaml', 'yml', 'ini', 'cfg', 'conf', 'sh', 'js', 'ts', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'css', 'html', 'sql'].includes(ext)) {
    return 'text';
  }

  // PDF
  if (mime === 'application/pdf' || ext === 'pdf') {
    return 'pdf';
  }

  // DOCX (Office Open XML)
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx') {
    return 'docx';
  }

  return 'unknown';
}

/**
 * Extract text from plain text files.
 * Handles UTF-8 encoding, strips control characters.
 */
function extractPlainText(buffer) {
  return buffer
    .toString('utf-8')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // Strip control chars (keep \n, \r, \t)
    .trim();
}

/**
 * Extract text from PDF files using pdf-parse.
 *
 * pdf-parse uses Mozilla's pdf.js under the hood.
 * It handles most PDF variants including scanned text (if OCR'd).
 * It does NOT do OCR — image-only PDFs return empty text.
 */
async function extractPdf(buffer) {
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const result = await pdfParse(buffer);
    return result.text?.trim() || '';
  } catch (err) {
    console.warn(`[text-extractor] PDF extraction failed: ${err.message}`);
    return '';
  }
}

/**
 * Extract text from DOCX files using mammoth.
 *
 * DOCX files are ZIP archives containing XML. Mammoth parses
 * the document.xml inside and extracts clean text, preserving
 * paragraph structure but stripping formatting.
 *
 * This is the lightweight approach vs full OOXML parsing.
 * For a more thorough extractor (tables, headers, footers),
 * you could use libreoffice --headless --convert-to txt,
 * but that requires LibreOffice installed on the system.
 */
async function extractDocx(buffer) {
  try {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value?.trim() || '';
  } catch (err) {
    console.warn(`[text-extractor] DOCX extraction failed: ${err.message}`);
    return '';
  }
}

/**
 * Get supported file extensions for display/documentation.
 */
export const SUPPORTED_FORMATS = {
  text: ['txt', 'md', 'csv', 'log', 'json', 'xml', 'yaml', 'yml', 'sh', 'js', 'ts', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'css', 'html', 'sql'],
  pdf: ['pdf'],
  docx: ['docx'],
};
