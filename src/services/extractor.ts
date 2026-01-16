// Takes a PDF buffer and extracts text content from it
import { extractText } from 'unpdf';

export async function extractTextFromDocument(pdfBuffer: Buffer): Promise<string> {
    
    const uint8Array = new Uint8Array(pdfBuffer);
    const {text} = await extractText(uint8Array);
    return text.join('\n');
    
}




export function chunkText(text: string, chunkSize: number = 300 , overlap: number = 60): string[] {
    const chunks: string[] = [];
    let start = 0;
    const textLength = text.length;

    while (start < textLength) {
        let end = start + chunkSize;
        if (end > textLength) {
            end = textLength;
        }
        const chunk = text.slice(start, end).trim();
        chunks.push(chunk);
        start += chunkSize - overlap;
    }

    return chunks;
}