"use strict";
document.addEventListener('DOMContentLoaded', () => {
    const dataTypeSelect = document.getElementById('dataType');
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const fetchButton = document.getElementById('fetchButton');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const resultsDiv = document.getElementById('results');
    const responseOutputDiv = document.getElementById('responseOutput');
    // Set default dates (e.g., last 7 days)
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7);
    const formatDate = (date) => {
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
        resultsDiv.innerHTML = '<p>Fetching data...</p>';
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
            }
            catch (parseError) {
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
                if (responseData.data && responseData.data.length > 0) {
                    // Simple table view for data
                    const data = responseData.data;
                    const headers = Object.keys(data[0]);
                    let tableHtml = '<table><thead><tr>';
                    headers.forEach(header => {
                        tableHtml += `<th>${header}</th>`;
                    });
                    tableHtml += '</tr></thead><tbody>';
                    data.forEach(row => {
                        tableHtml += '<tr>';
                        headers.forEach(header => {
                            let cellValue = row[header];
                            // Format timestamp column for better readability
                            if (header === 'timestamp' || header === 'fundingTime') {
                                cellValue = new Date(cellValue).toISOString(); // ISO 8601 format
                            }
                            else if (typeof cellValue === 'number') {
                                cellValue = cellValue.toFixed(8); // Format numbers to 8 decimal places
                            }
                            tableHtml += `<td>${cellValue}</td>`;
                        });
                        tableHtml += '</tr>';
                    });
                    tableHtml += '</tbody></table>';
                    resultsDiv.innerHTML = tableHtml;
                }
                else {
                    resultsDiv.innerHTML = '<p>No data found for the selected range.</p>';
                }
            }
            else {
                // Display backend error message
                resultsDiv.innerHTML = `<p>Backend Error: ${responseData.message}</p>`;
                responseOutputDiv.classList.add('error'); // Add error class for styling
            }
        }
        catch (error) {
            // Handle network or other unexpected errors
            console.error('Fetch error:', error);
            resultsDiv.innerHTML = `<p>An error occurred while making the request.</p>`;
            responseOutputDiv.innerHTML = `<p>Network Error: ${error.message}</p>`;
            responseOutputDiv.classList.add('error');
        }
        finally {
            // Re-enable button and hide loading indicator
            fetchButton.disabled = false;
            loadingIndicator.style.display = 'none';
        }
    });
});
