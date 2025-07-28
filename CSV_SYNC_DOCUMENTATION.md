# CSV Data Synchronization Feature

## Overview

The CSV Data Synchronization feature automatically manages data consistency between two CSV files:
- `list-girl.csv` - Contains current crawl results
- `list-girl-stored.csv` - Maintains persistent storage of all discovered records

This feature ensures that the stored CSV file contains an up-to-date, deduplicated collection of all discovered records while keeping the current CSV file clean with only new/unique results from the latest crawl session.

## How It Works

### Automatic Synchronization

The synchronization automatically triggers after the "crawl categories" operation completes successfully. The process includes:

1. **Duplicate Detection and Removal**
   - Compares records in `list-girl.csv` against `list-girl-stored.csv` using Profile URL as unique identifier
   - Removes duplicate records from `list-girl.csv` that already exist in `list-girl-stored.csv`
   - Preserves existing records in `list-girl-stored.csv`

2. **New Record Addition**
   - Identifies records that exist in `list-girl.csv` but not in `list-girl-stored.csv`
   - Appends these new records to `list-girl-stored.csv`
   - Keeps these new records in `list-girl.csv` as well

3. **Obsolete Record Cleanup**
   - Identifies records that exist in `list-girl-stored.csv` but are missing from current `list-girl.csv`
   - Removes these obsolete records from `list-girl-stored.csv`

### Manual Synchronization

You can also trigger synchronization manually using the API endpoint:

```bash
POST /api/sync-csv-data
```

**Authentication Required**: You must be logged in to use this endpoint.

**Response Format**:
```json
{
  "success": true,
  "message": "CSV data synchronization completed successfully",
  "results": {
    "newRecords": 3,
    "duplicatesRemoved": 1,
    "obsoleteRecords": 2,
    "totalStored": 4,
    "totalCurrent": 3
  }
}
```

## File Downloads

### Available Download Endpoints

1. **Current Crawl Results**
   ```
   GET /api/download/list-girl-csv
   ```
   Downloads the current crawl results (new/unique records only)

2. **Stored Data Collection**
   ```
   GET /api/download/list-girl-stored-csv
   ```
   Downloads the complete stored data collection (all discovered records)

3. **Detailed Profile Data**
   ```
   GET /api/download/detail-girls-csv
   ```
   Downloads detailed profile information from the girls crawler

## CSV File Structure

Both CSV files use the same structure:

```csv
Name,Location,Profile URL
"Alice Johnson","Zurich","https://example.com/alice"
"Bob Smith","Geneva","https://example.com/bob"
```

**Fields**:
- **Name**: The person's name (quoted to handle commas)
- **Location**: Geographic location (quoted to handle commas)
- **Profile URL**: Unique identifier used for deduplication

## Logging and Monitoring

### Server Logs

The synchronization process provides detailed logging:

```
🔄 Starting data synchronization between list-girl.csv and list-girl-stored.csv...
📊 Read 4 records from list-girl.csv
📊 Read 3 records from list-girl-stored.csv
🔍 Analysis: 3 new, 1 duplicates, 2 obsolete
✅ Updated list-girl.csv: removed 1 duplicates, kept 3 new records
✅ Updated list-girl-stored.csv: removed 2 obsolete, added 3 new records
✅ Data synchronization completed: 3 new records added, 1 duplicates removed, 2 obsolete records cleaned
```

### Web UI Integration

The synchronization status is broadcast to connected clients via WebSocket, allowing real-time monitoring in the dashboard.

## Error Handling

The synchronization feature includes comprehensive error handling:

- **File Access Errors**: Handles missing or inaccessible CSV files
- **Parsing Errors**: Gracefully handles malformed CSV data
- **Write Errors**: Provides detailed error messages for file write failures
- **Rollback**: Maintains data integrity if synchronization fails

### Error Response Format

```json
{
  "success": false,
  "error": "CSV synchronization failed",
  "message": "Detailed error description"
}
```

## Implementation Details

### Key Functions

1. **`synchronizeCSVData()`** - Main synchronization logic
2. **`readCSVFile(filePath)`** - Parses CSV files into record objects
3. **`writeCSVFile(filePath, records)`** - Writes record objects to CSV format

### Thread Safety

The synchronization process includes proper locking mechanisms to prevent concurrent file access issues during crawler operations.

### Performance Considerations

- Uses Map-based lookups for efficient O(1) duplicate detection
- Processes files in memory for better performance
- Minimizes file I/O operations

## Testing

### Automated Tests

Run the test suite to verify synchronization logic:

```bash
node test-csv-sync.js
```

### API Testing

Test the manual synchronization endpoint:

```bash
node test-sync-api.js
```

## Configuration

No additional configuration is required. The feature works with the existing CSV file structure and integrates seamlessly with the current crawler workflow.

## Benefits

1. **Data Integrity**: Ensures no duplicate records in the stored collection
2. **Efficiency**: Keeps current crawl results clean and focused
3. **Historical Data**: Maintains a complete record of all discovered profiles
4. **Automation**: Runs automatically after each successful crawl
5. **Flexibility**: Supports manual synchronization when needed
6. **Monitoring**: Provides detailed logging and real-time status updates
