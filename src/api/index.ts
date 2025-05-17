import express, { Request, Response } from 'express';
import path from 'path';
import moment from 'moment';
import { BinanceService, IBinanceService, IRawFundingRateRecord, IRawOpenInterestRecord, IRawLongShortRatioRecord, IRawTakerBuySellVolumeRecord } from '../binance';

const app = express();
const port = process.env.PORT || 3000;

// Initialize the Binance Service
const binanceService: IBinanceService = new BinanceService();

// Serve static files from the 'public' directory within the compiled dist folder
// The compiled public files will be in dist/public relative to the project root
// The api/index.js file will be in dist/api, so need to go up two levels (../../)
app.use(express.static(path.join(__dirname, '../../public')));

// Helper function to get the timestamp property based on data type
// This function safely accesses either 'timestamp' or 'fundingTime'
function getRecordTimestamp(record: any, dataType: string): number {
    let ts: any; // Use any initially as property name varies

    switch(dataType) {
        case 'fundingRate':
            // Cast to the specific type to access the known property name
            const frRecord = record as IRawFundingRateRecord;
            ts = frRecord.fundingTime;
            break;
        case 'openInterest':
            const oiRecord = record as IRawOpenInterestRecord;
            ts = oiRecord.timestamp;
            break;
        case 'longShortRatio':
            const lsrRecord = record as IRawLongShortRatioRecord;
            ts = lsrRecord.timestamp;
            break;
        case 'takerVolume':
            const tvRecord = record as IRawTakerBuySellVolumeRecord;
            ts = tvRecord.timestamp;
            break;
        default:
            // Should not happen if dataType validation before this is correct
             throw new Error(`Unknown data type ${dataType} in getRecordTimestamp.`);
    }

     // Validate that the found timestamp is a number
    if (typeof ts === 'number') {
        return ts;
    } else {
         // Log the problematic record for debugging
         console.error('Invalid timestamp found for record:', record, 'with dataType:', dataType, 'Timestamp value:', ts);
         // Throw an error if a valid timestamp could not be retrieved
         throw new Error('Invalid record structure: timestamp property missing or not a number.');
    }
}


// Define the API endpoint for fetching data
app.get('/api/data', async (req: Request, res: Response) => {
    const { dataType, startTime, endTime } = req.query;

    // Basic validation
    if (!dataType || typeof dataType !== 'string' || !startTime || typeof startTime !== 'string' || !endTime || typeof endTime !== 'string') {
        return res.status(400).json({
            success: false,
            message: 'Missing or invalid required parameters: dataType, startTime, and endTime.',
            details: null
        });
    }

    const startTimestamp = parseInt(startTime as string, 10);
    const endTimeStamp = parseInt(endTime as string, 10);

    if (isNaN(startTimestamp) || isNaN(endTimeStamp) || startTimestamp >= endTimeStamp) {
        return res.status(400).json({
            success: false,
            message: 'Invalid startTime or endTime. Must be valid timestamps (ms) and startTime must be less than endTime.',
            details: null
        });
    }

    console.log(`API Request: Fetching ${dataType} from ${moment(startTimestamp).toISOString()} to ${moment(endTimeStamp).toISOString()}`);

    try {
        // Use 'any' for fetchedRecords as the array contains a union of types
        let fetchedRecords: any[] = [];
        // Increased attempts to fetch potentially longer ranges in chunks, based on typical Binance API limits.
        // A 5-minute interval data type (like OI, L/S Ratio, Taker Volume) returns max 500 records per call,
        // covering about 500 * 5 minutes = ~41 hours. To cover a week (7 days), you'd need ~4 calls.
        // For Funding Rate (hourly), max 1000 records/call, covering 1000 hours (~41 days).
        // Max attempts of 200 could cover 200 days for 5m data or much longer for Funding Rate,
        // depending on the *actual* time range returned per call by the service methods.
        const maxAttempts = 200;
        let attempts = 0;
        let currentStartTime = startTimestamp;

        // Binance API returns data *from* the provided startTime.
        // We need to repeatedly call the API, updating the start time
        // based on the latest record received, until we've fetched data
        // up to or past the requested endTime.
        // Note: Binance limits the number of records per call (e.g., 500 or 1000)
        // and the time range covered per call (e.g., 1 day or 200 days).
        // The `binanceService` methods handle the max time range per call.
        // The loop here handles fetching across a potentially much larger range.

        while (currentStartTime < endTimeStamp && attempts < maxAttempts) {
             let batch: any[] = []; // Type will depend on the data type requested
            try {
                 switch (dataType) {
                    case 'fundingRate':
                        // get_funding_rate_history internally uses `start_time` + 1000ms.
                        batch = await binanceService.get_funding_rate_history(currentStartTime);
                        break;
                    case 'openInterest':
                         batch = await binanceService.get_open_interest_history(currentStartTime);
                        break;
                    case 'longShortRatio':
                         batch = await binanceService.get_long_short_ratio_history(currentStartTime);
                        break;
                    case 'takerVolume':
                         batch = await binanceService.get_taker_buy_sell_volume_history(currentStartTime);
                        break;
                    default:
                        // This case should be caught by the initial validation, but included for safety
                        return res.status(400).json({
                            success: false,
                            message: `Unsupported data type: ${dataType}. Supported types: fundingRate, openInterest, longShortRatio, takerVolume.`,
                             details: null
                        });
                 }
            } catch (fetchError: any) {
                 // Log the specific fetch error but return a generic error to the user
                 console.error(`Error fetching batch for ${dataType} starting at ${moment(currentStartTime).toISOString()}:`, fetchError.message);
                 // Pass the original error message back in details for debugging
                 return res.status(500).json({
                     success: false,
                     message: `Failed to fetch data from Binance API for data type ${dataType}.`,
                     details: fetchError.message
                 });
            }

            // Process the fetched batch
            if (batch.length === 0) {
                // If no data is returned for the current period, we've likely reached the end of available data or end of history
                console.log(`Batch for ${dataType} starting at ${moment(currentStartTime).toISOString()} returned 0 records. Assuming end of data.`);
                break;
            }

            // Add fetched batch to total records. Use a Set or Map for de-duplication if necessary.
            // The getRecordTimestamp will throw if a record is malformed, preventing it from being added.
            batch.forEach(record => {
                try {
                     // Add the record to a temporary list. De-duplication and final filtering happens later.
                     fetchedRecords.push(record);
                } catch(e) {
                     console.warn("Skipping malformed record during batch processing:", record, e);
                }
            });


            // Find the timestamp of the latest record in the batch
            // Sorting the batch allows us to easily get the earliest and latest timestamps
            const sortedBatch = batch.sort((a, b) => {
                try {
                    const tsA = getRecordTimestamp(a, dataType);
                    const tsB = getRecordTimestamp(b, dataType);
                    return tsA - tsB;
                } catch (e) {
                    // This catch might be redundant if getRecordTimestamp throws, but good for safety
                    console.error("Error getting timestamp during batch sort:", e);
                    // Return 0 or throw, depending on how you want to handle malformed records during sort
                    return 0; // Causes unpredictable sort order for bad records
                }
            });

            const latestRecord = sortedBatch[sortedBatch.length - 1];

            // Set the next start time to the timestamp of the latest record + 1 ms
            // This ensures the next query starts immediately after the last record received, preventing duplicates at the boundary.
            try {
                 const latestTimestamp = getRecordTimestamp(latestRecord, dataType);

                 // If the latest timestamp from this batch is less than or equal to the start time we used for this batch,
                 // it means we haven't made progress. This can happen if the API returns only old data or is stuck.
                 // Add a check to ensure we are advancing.
                 if (latestTimestamp <= currentStartTime) {
                      console.warn(`Latest timestamp (${moment(latestTimestamp).toISOString()}) from batch starting at ${moment(currentStartTime).toISOString()} is not strictly after start time. Breaking loop to prevent infinite loop.`);
                      break; // Prevent infinite loop if API returns same data repeatedly
                 }

                 currentStartTime = latestTimestamp + 1;

                 // Also break if the new start time is already past the requested end time
                 if (currentStartTime > endTimeStamp) {
                     break;
                 }

            } catch(e) {
                 console.error("Error getting timestamp for latest record in batch:", latestRecord, e);
                 // If the last record in a batch is invalid, break the loop to prevent infinite loop
                 break;
            }


            attempts++;

             // Optional: Add a check to break if a large number of attempts are made without reaching the end time
             if (attempts >= maxAttempts) {
                  console.warn(`Max attempts (${maxAttempts}) reached for ${dataType} without reaching end time ${moment(endTimeStamp).toISOString()}. Stopping fetch.`);
                  break;
             }

        }

        // Filter records to be within the requested endTime (exclusive of endTimeStamp)
        // And de-duplicate records using a Map by their timestamp
        const uniqueRecordsMap = new Map<number, any>(); // Map key is timestamp, value is the record

         fetchedRecords.forEach(record => {
             let ts: number;
             try {
                ts = getRecordTimestamp(record, dataType);
             } catch (e) {
                 console.warn("Skipping record with invalid timestamp during final processing:", record);
                 return; // Skip this record
             }

             // Ensure timestamp is within the requested range [startTimestamp, endTimeStamp)
             // endTimeStamp is the start of the day *after* the user's selected end date from the frontend.
             // This means records up to 23:59:59.999 of the end date will be included.
             if (ts >= startTimestamp && ts < endTimeStamp) {
                 // Use the timestamp as the key to filter duplicates. Map keeps the last one added if timestamps are identical.
                 // Since we increment start time by +1ms for subsequent calls, identical timestamps should be rare unless API is buggy.
                 uniqueRecordsMap.set(ts, record);
             }
         });

        // Convert map values back to an array and sort by timestamp
        const data = Array.from(uniqueRecordsMap.values()).sort((a, b) => {
             try {
                const tsA = getRecordTimestamp(a, dataType);
                const tsB = getRecordTimestamp(b, dataType);
                return tsA - tsB;
             } catch (e) {
                  // This catch should not be reached if getRecordTimestamp throws on invalid records
                  console.error("Error getting timestamp during final sort:", e);
                  return 0; // Should not happen if filtered records are valid
             }
        });


        console.log(`API Request: Successfully fetched and filtered ${data.length} records for ${dataType} within the requested range.`);
        console.log(`Total unique records processed from API calls before range filtering: ${fetchedRecords.length}`);
        console.log(`Total unique records within requested range [${moment(startTimestamp).toISOString()}, ${moment(endTimeStamp).toISOString()}): ${data.length}`);

        res.json({
            success: true,
            message: 'Data fetched successfully.',
            data: data,
            meta: {
                dataType,
                startTime: startTimestamp,
                endTime: endTimeStamp, // This is the start of the day AFTER the user's selected end date
                requestedEndDate: moment(endTimeStamp - 1).format('YYYY-MM-DD'), // For clarity in frontend
                recordCount: data.length, // Count after filtering by range
                totalUniqueRecordsFetched: uniqueRecordsMap.size // Count of unique records from API within the range [startTimestamp, endTimeStamp)
            }
        });

    } catch (error: any) {
        console.error(`API Request Error for ${dataType}:`, error.message);
        // If the error has a specific message (like from BinanceService validation or timestamp helper), use it
        const errorMessage = error.message || 'An unknown error occurred.';
        res.status(500).json({
            success: false,
            message: `An error occurred while processing your request for data type ${dataType}.`,
            details: errorMessage
        });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`Frontend available at http://localhost:${port}/`);
});