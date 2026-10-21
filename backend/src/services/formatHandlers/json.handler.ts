import { Transform } from "stream";
import { createGzip } from "zlib";
import type { ExportDataType, ExportDataRecord } from "../../types/export.types.js";
import { logger } from "../../utils/logger.js";

/**
 * JSON Format Handler
 * 
 * Implements streaming JSON generation for large datasets.
 * Memory profile: Bounded to stream buffer size (~64KB) regardless of dataset size.
 * Produces valid JSON array structure even when streaming.
 * Supports GZIP compression when output exceeds configured threshold.
 */
export class JSONHandler {
  /**
   * Generate JSON output from data stream
   * 
   * @param dataStream - Async iterable of data records
   * @param dataType - Type of data being exported
   * @param compress - Whether to apply GZIP compression
   * @returns Readable stream of JSON data (optionally compressed)
   */
  async generate(
    dataStream: AsyncIterable<ExportDataRecord>,
    dataType: ExportDataType,
    compress: boolean
  ): Promise<NodeJS.ReadableStream> {
    logger.info({ dataType, compress }, "Generating JSON export");

    // Create a properly-typed Transform subclass that tracks first-record
    class JsonExportTransform extends Transform {
      private _firstRecord = true;
      private readonly dataType: ExportDataType;

      constructor(dataType: ExportDataType) {
        super({ objectMode: true });
        this.dataType = dataType;
      }

      override _construct(callback: (error?: Error | null) => void) {
        this.push(`{"dataType":"${this.dataType}","records":[`);
        this._firstRecord = true;
        callback();
      }

      override _transform(chunk: ExportDataRecord, _encoding: BufferEncoding, callback: (err?: Error | null) => void) {
        try {
          if (this._firstRecord) {
            this._firstRecord = false;
          } else {
            this.push(",");
          }
          this.push(JSON.stringify(chunk));
          callback();
        } catch (err) {
          callback(err as Error);
        }
      }

      override _flush(callback: (err?: Error | null) => void) {
        this.push("]}");
        callback();
      }
    }

    const jsonStream = new JsonExportTransform(dataType);

    // Convert async iterable to readable stream
    const dataIteratorStream = new Transform({
      objectMode: true,
      async transform(chunk, _encoding, callback) {
        callback(null, chunk);
      },
    });

    // Start consuming the async iterable
    (async () => {
      try {
        for await (const record of dataStream) {
          if (!dataIteratorStream.write(record)) {
            // Wait for drain event if buffer is full
            await new Promise((resolve) => dataIteratorStream.once("drain", resolve));
          }
        }
        dataIteratorStream.end();
      } catch (error) {
        dataIteratorStream.destroy(error as Error);
      }
    })();

    // Create the pipeline
    if (compress) {
      const gzip = createGzip();
      dataIteratorStream.pipe(jsonStream).pipe(gzip);
      return gzip as NodeJS.ReadableStream;
    } else {
      dataIteratorStream.pipe(jsonStream);
      return jsonStream as NodeJS.ReadableStream;
    }
  }
}
