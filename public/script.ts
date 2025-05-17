// Define a basic interface for the data records received from the backend
// This helps TypeScript understand the structure, even though it's simplified
interface FrontendBinanceRecord {
    // Records from the API will have either 'timestamp' or 'fundingTime'
    timestamp?: number;
    fundingTime?: number;
    // Allow other properties, as their names and types depend on the data type
    // Using a string index signature makes accessing properties by variable names safe
    [key: string]: any;
}


document.addEventListener('DOMContentLoaded', () => {
    const dataTypeSelect = document.getElementById('dataType') as HTMLSelectElement;
    const startDateInput = document.getElementById('startDate') as HTMLInputElement;
    const endDateInput = document.getElementById('endDate') as HTMLInputElement;
    const fetchButton = document.getElementById('fetchButton') as HTMLButtonElement;
    const loadingIndicator = document.getElementById('loadingIndicator') as HTMLDivElement;
    const resultsDiv = document.getElementById('results') as HTMLDivElement;
    const responseOutputDiv = document.getElementById('responseOutput') as HTMLDivElement;

    // Set default dates (e.g., last 7 days)
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7);

    const formatDate = (date: Date): string => {
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
        const dd = String(date.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    };

    startDateInput.value = formatDate(sevenDaysAgo);
    endDateInput.value = formatDate(today);

    // Event listener for the fetch button
    fetchButton.addEventListener('click', async () => {
        const dataType = dataTypeSelect.value;
        const startDateStr = startDateInput.value;
        const endDateStr = endDateInput.value;

        // Simple client-side validation
        if (!startDateStr || !endDateStr) {
            alert('Please select both start and end dates.');
            return;
        }

        // Convert dates to timestamps (start of the day UTC)
        // Using 'YYYY-MM-DD' strings with new Date() parses them as UTC midnight
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/parse#date_time_string_format
        const startDate = new Date(startDateStr);
        const endDate = new Date(endDateStr);

        // Add one day to the end date timestamp to include the entire end day
        // The backend filters records strictly < endTimeStamp, so we need to make the end time the start of the *next* day.
         const endOfDay = new Date(endDate);
         endOfDay.setDate(endDate.getDate() + 1);


        const startTimeStamp = startDate.getTime();
        const endTimeStamp = endOfDay.getTime(); // Use timestamp for the start of the next day

        if (startTimeStamp >= endTimeStamp) {
             alert('Start date must be before end date.');
             return;
        }


        // Clear previous results and errors
        resultsDiv.innerHTML = '<p>Fetching data... This may take a while for large date ranges due to API limits.</p>';
        responseOutputDiv.innerHTML = '<p>Waiting for response...</p>';
        responseOutputDiv.classList.remove('error'); // Remove error class
        fetchButton.disabled = true;
        loadingIndicator.style.display = 'block';

        try {
            // Construct the API URL
            const apiUrl = `/api/data?dataType=${dataType}&startTime=${startTimeStamp}&endTime=${endTimeStamp}`;

            // Make the API call
            const response = await fetch(apiUrl);

            // Read the response body as text first to handle potential non-JSON errors
            const responseText = await response.text();
            let responseData;

            try {
                 responseData = JSON.parse(responseText);
             } catch (parseError) {
                 // If parsing fails, it means the response wasn't JSON (e.g., server error page)
                 console.error('Failed to parse JSON response:', responseText);
                 responseOutputDiv.innerHTML = `<p>API Error: Invalid JSON response.</p><pre>${responseText}</pre>`;
                 responseOutputDiv.classList.add('error');
                 resultsDiv.innerHTML = '<p>Failed to fetch data due to invalid response from server.</p>';
                 return; // Stop processing
            }


            // Display raw response (formatted JSON)
            responseOutputDiv.innerHTML = `<pre>${JSON.stringify(responseData, null, 2)}</pre>`;

            if (responseData.success) {
                // Display fetched data
                if (responseData.data && Array.isArray(responseData.data) && responseData.data.length > 0) {
                    // Cast data to our frontend interface type for safer access
                    const data: FrontendBinanceRecord[] = responseData.data;
                    // Determine headers from the first record
                     const headers = Object.keys(data[0]);
                    let tableHtml = `<table><thead><tr>`; // Use a more descriptive header perhaps?
                     headers.forEach(header => {
                        tableHtml += `<th>${header.replace(/([A-Z])/g, ' $1').trim()}</th>`; // Add space before capital letters for readability
                    });
                    tableHtml += '</tr></thead><tbody>';

                    data.forEach((row: FrontendBinanceRecord) => { // Explicitly type 'row' here
                        tableHtml += '<tr>';
                        headers.forEach(header => {
                             let cellValue = row[header]; // Access properties safely via index signature
                             // Format timestamp column for better readability
                             if (header === 'timestamp' || header === 'fundingTime') {
                                 // Ensure the value is a number before creating a Date object
                                 cellValue = typeof cellValue === 'number' ? new Date(cellValue).toISOString() : String(cellValue); // Convert to string if not a number
                             } else if (typeof cellValue === 'number') {
                                cellValue = cellValue.toFixed(8); // Format numbers to 8 decimal places
                             } else if (typeof cellValue !== 'string') {
                                cellValue = String(cellValue); // Ensure all other types are strings
                             }
                             tableHtml += `<td>${cellValue}</td>`;
                        });
                        tableHtml += '</tr>';
                    });
                    tableHtml += '</tbody></table>';

                    resultsDiv.innerHTML = tableHtml;

                } else {
                    resultsDiv.innerHTML = '<p>No data found for the selected range.</p>';
                }
            } else {
                // Display backend error message
                resultsDiv.innerHTML = `<p>Backend Error: ${responseData.message}</p>`;
                responseOutputDiv.classList.add('error'); // Add error class for styling
            }

        } catch (error: any) {
            // Handle network or other unexpected errors
            console.error('Fetch error:', error);
            resultsDiv.innerHTML = `<p>An error occurred while making the request.</p>`;
            responseOutputDiv.innerHTML = `<p>Network Error: ${error.message}</p>`;
            responseOutputDiv.classList.add('error');
        } finally {
            // Re-enable button and hide loading indicator
            fetchButton.disabled = false;
            loadingIndicator.style.display = 'none';
        }
    });
});