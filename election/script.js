document.addEventListener('DOMContentLoaded', () => {
    // --- Global State ---
    let rawData = []; // Data directly from source (Excel/CSV)
    let processedData = []; // Cleaned and processed data used by UIs
    let psNames = []; // Unique, sorted PS names
    let psNameToIndexMap = {}; // Map PS name to index in processedData
    let currentView = 'ballot_count'; // 'ballot_count' or 'contestant_names'
    let totalAllBallots = 0;
    let isLoading = false; // Flag to prevent concurrent loading

    // --- DOM Element References ---
    const fileInput = document.getElementById('excelFile');
    const googleSheetUrlInput = document.getElementById('googleSheetUrl'); // New
    const loadFromUrlButton = document.getElementById('loadFromUrlButton'); // New
    const statusLabel = document.getElementById('statusLabel');
    const switchViewButton = document.getElementById('switchViewButton');

    // Ballot Count UI Elements
    const ballotCountView = document.getElementById('ballot-count-view');
    const exportButton = document.getElementById('exportButton');
    const ballotSearchInput = document.getElementById('ballotSearchInput');
    const ballotSearchButton = document.getElementById('ballotSearchButton');
    const ballotSummaryLabel = document.getElementById('ballotSummaryLabel');
    const ballotTableBody = document.getElementById('ballotTableBody');
    const tooltipElement = document.getElementById('tooltip');

    // Contestant Names UI Elements
    const contestantNamesView = document.getElementById('contestant-names-view');
    const psSearchInput = document.getElementById('psSearchInput');
    const psList = document.getElementById('psList');
    const zpcCandidateList = document.getElementById('zpcCandidateList');
    const apCandidateList = document.getElementById('apCandidateList');
    const wardCandidateList = document.getElementById('wardCandidateList');

    // --- Utility Functions (getCandidateNamesJS, safeParseInt - unchanged) ---

    /**
     * Extracts valid candidate names from a row object based on a prefix.
     * @param {object} row - The data row object.
     * @param {string} prefix - The prefix for candidate columns (e.g., 'ZPM').
     * @returns {string[]} - An array of valid candidate names.
     */
    function getCandidateNamesJS(row, prefix) {
        const candidates = [];
        if (!row) return candidates;

        for (const key in row) {
            if (Object.hasOwnProperty.call(row, key) && typeof key === 'string' && key.startsWith(prefix)) {
                let value = row[key];
                if (value !== null && value !== undefined) {
                    const strValue = String(value).trim();
                    if (strValue && strValue.toLowerCase() !== 'nil') {
                        candidates.push(strValue);
                    }
                }
            }
        }
        return candidates;
    }

    /**
     * Safely converts a value to an integer, defaulting to 0.
     * @param {*} value - The value to convert.
     * @returns {number} - The integer value or 0.
     */
    function safeParseInt(value) {
        if (value === null || value === undefined || String(value).trim() === '') {
            return 0;
        }
        const num = Number(String(value).trim());
        return Number.isFinite(num) ? Math.floor(num) : 0;
    }

    // --- Event Listeners ---
    fileInput.addEventListener('change', handleFileLoad);
    loadFromUrlButton.addEventListener('click', handleUrlLoad); // New listener
    switchViewButton.addEventListener('click', switchView);
    exportButton.addEventListener('click', exportBallotTable);
    ballotSearchButton.addEventListener('click', filterBallotTable);
    ballotSearchInput.addEventListener('input', filterBallotTable);
    psSearchInput.addEventListener('input', filterPsList);
    psList.addEventListener('click', handlePsSelect);

    // Tooltip listeners for ballot table
    ballotTableBody.addEventListener('mouseover', handleTableMouseOver);
    ballotTableBody.addEventListener('mouseout', handleTableMouseOut);
    ballotTableBody.addEventListener('mousemove', handleTableMouseMove);


    // --- Core Logic Functions ---

    /**
     * Generic function to start the loading process.
     */
    function startLoading(message = 'Loading data...') {
        if (isLoading) {
            console.warn("Already loading data.");
            return false; // Indicate loading didn't start
        }
        isLoading = true;
        statusLabel.textContent = message;
        disableControls(); // Disable controls during load
        // Clear previous results visually
        resetUIOnly();
        return true; // Indicate loading started
    }

    /**
     * Generic function to end the loading process (success or failure).
     */
    function endLoading() {
        isLoading = false;
        // Re-enable controls based on whether data is present
        if (processedData && processedData.length > 0) {
            enableControls();
        } else {
            disableControls(); // Keep disabled if load failed or no data
        }
         // Reset file input to allow reloading the same file if needed
         fileInput.value = '';
    }

     /**
     * Clears UI elements without resetting the underlying data state immediately.
     */
    function resetUIOnly() {
        ballotTableBody.innerHTML = '';
        psList.innerHTML = '';
        clearCandidateColumnsUI();
        ballotSummaryLabel.textContent = 'Processing...';
        tooltipElement.style.display = 'none';
        // Don't clear statusLabel here, it's managed by startLoading/endLoading
    }


    /**
     * Handles the loading and processing of the selected local Excel file.
     */
    function handleFileLoad(event) {
        const file = event.target.files[0];
        if (!file) return; // No file selected

        if (!startLoading(`Loading file: ${file.name}...`)) return;

        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                if (!sheetName) throw new Error("Excel file has no sheets.");

                rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
                if (!rawData.length) throw new Error(`Sheet '${sheetName}' is empty.`);

                const headers = Object.keys(rawData[0] || {});
                const psNameHeader = headers.find(h => h.trim().toLowerCase() === 'ps name');
                if (!psNameHeader) throw new Error("Required column 'PS Name' not found.");

                // Process Data & Update UI
                processRawData(rawData, psNameHeader);
                updateAllUIs(); // Central function to update both views
                statusLabel.textContent = `Loaded ${processedData.length} unique PS from: ${file.name}`;

            } catch (error) {
                console.error("Error processing Excel file:", error);
                statusLabel.textContent = `Error: ${error.message}`;
                alert(`Error loading or processing file:\n${error.message}`);
                resetApplicationState(); // Clear data on error
            } finally {
                endLoading(); // End loading process regardless of success/failure
            }
        };

        reader.onerror = (e) => {
            console.error("FileReader error:", e);
            statusLabel.textContent = 'Error reading file.';
            alert("An error occurred while trying to read the file.");
            resetApplicationState();
            endLoading();
        };

        reader.readAsArrayBuffer(file);
    }

    /**
     * Handles loading and processing data from a Google Sheet CSV URL.
     */
    async function handleUrlLoad() {
        const url = googleSheetUrlInput.value.trim();
        if (!url) {
            alert("Please paste a valid Google Sheet 'Publish to web' CSV URL first.");
            return;
        }
        // Basic check for expected format (improve if needed)
        if (!url.includes('/pub?output=csv')) {
             alert("Invalid URL format. Please make sure you use the 'Publish to web' link ending in '/pub?output=csv'.");
             return;
        }

        if (!startLoading(`Loading from URL...`)) return;

        try {
            // Use fetch to get the CSV data
            // Add 'cors' mode if needed, though published CSVs are usually public
            const response = await fetch(url);

            if (!response.ok) {
                // Handle HTTP errors (404 Not Found, 403 Forbidden, etc.)
                throw new Error(`Failed to fetch data. Status: ${response.status} ${response.statusText}. Ensure the link is correct and published publicly.`);
            }

            // Get CSV data as text
            const csvText = await response.text();
            if (!csvText) {
                 throw new Error("Fetched data is empty. Check the Google Sheet.");
            }

            // Use SheetJS to parse the CSV string
            // Create a workbook from the string data
            const workbook = XLSX.read(csvText, { type: 'string', raw: true }); // raw:true might help with type interpretation
            const sheetName = workbook.SheetNames[0]; // CSV will likely have only one sheet
            if (!sheetName) throw new Error("Could not parse CSV data.");

            rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
             if (!rawData.length) throw new Error("CSV data is empty after parsing.");


            // --- Identify PS Name Header (Crucial for CSV) ---
            // CSV headers might have subtle differences, find case-insensitively
            const headers = Object.keys(rawData[0] || {});
            const psNameHeader = headers.find(h => h.trim().toLowerCase() === 'ps name');
            if (!psNameHeader) throw new Error("Required column 'PS Name' not found in the CSV data.");


            // Process Data & Update UI
            processRawData(rawData, psNameHeader);
            updateAllUIs();
            statusLabel.textContent = `Loaded ${processedData.length} unique PS from URL.`;

        } catch (error) {
            console.error("Error loading/processing Google Sheet URL:", error);
            statusLabel.textContent = `Error: ${error.message}`;
            alert(`Error loading from URL:\n${error.message}`);
            resetApplicationState(); // Clear data on error
        } finally {
            endLoading(); // End loading process
        }
    }


    /**
     * Cleans raw data, handles duplicates, calculates necessary values.
     * @param {object[]} sourceData - Data array from SheetJS (JSON).
     * @param {string} psNameKey - The exact key found for 'PS Name'.
     */
    function processRawData(sourceData, psNameKey) {
        // Reset processed data structures
        processedData = [];
        psNameToIndexMap = {};
        psNames = [];
        const seenPsNames = new Set();

        sourceData.forEach((rawRow, index) => {
            const originalPsName = String(rawRow[psNameKey] || '').trim();

            if (!originalPsName) {
                console.warn(`Skipping row ${index + 2} (source) due to empty PS Name.`);
                return;
            }
            if (seenPsNames.has(originalPsName)) {
                console.warn(`Skipping duplicate PS Name: "${originalPsName}" at row ${index + 2} (source).`);
                return;
            }
            seenPsNames.add(originalPsName);

            const processedRow = {
                originalIndex: index,
                psName: originalPsName,
                // Find voter column case-insensitively as well for robustness
                voters: safeParseInt(findValueCaseInsensitive(rawRow, 'Total Number of Voter') || '0'),
                candidates: {},
                ballotInfo: {}
            };

            processedRow.candidates.zpc = getCandidateNamesJS(rawRow, 'ZPM');
            processedRow.candidates.ap = getCandidateNamesJS(rawRow, 'APM');
            processedRow.candidates.ward = getCandidateNamesJS(rawRow, 'GPM');

            const zpcFlag = processedRow.candidates.zpc.length >= 2 ? 1 : 0;
            const apFlag = processedRow.candidates.ap.length >= 2 ? 1 : 0;
            const wardFlag = processedRow.candidates.ward.length >= 2 ? 1 : 0;

            processedRow.ballotInfo = {
                zpcNeeded: zpcFlag === 1,
                apNeeded: apFlag === 1,
                wardNeeded: wardFlag === 1,
                zpcTotal: zpcFlag * processedRow.voters,
                apTotal: apFlag * processedRow.voters,
                wardTotal: wardFlag * processedRow.voters,
                psTotal: (zpcFlag * processedRow.voters) + (apFlag * processedRow.voters) + (wardFlag * processedRow.voters)
            };

            processedData.push(processedRow);
        });

        processedData.sort((a, b) => a.psName.localeCompare(b.psName));

        processedData.forEach((row, newIndex) => {
             psNames.push(row.psName);
             psNameToIndexMap[row.psName] = newIndex;
        });
    }

    /**
    * Helper to find a value in an object using a case-insensitive key.
    * Returns the value associated with the first matching key found.
    * @param {object} obj The object to search in.
    * @param {string} targetKey The key to search for (case-insensitive).
    * @returns {*} The value found, or undefined if not found.
    */
    function findValueCaseInsensitive(obj, targetKey) {
        if (!obj || typeof targetKey !== 'string') return undefined;
        const lowerTargetKey = targetKey.toLowerCase();
        for (const key in obj) {
            if (Object.hasOwnProperty.call(obj, key) && String(key).toLowerCase() === lowerTargetKey) {
                return obj[key];
            }
        }
        return undefined; // Key not found
    }


    /**
     * Central function to trigger updates for both UI views.
     */
     function updateAllUIs() {
         updateBallotTableUI();
         populatePsListUI();
         // Clear candidate details initially after load
         clearCandidateColumnsUI();
         // Reset selection in PS list
         const previouslySelected = psList.querySelector('.selected');
         if (previouslySelected) {
             previouslySelected.classList.remove('selected');
         }
     }


    // --- UI Update Functions (updateBallotTableUI, filterBallotTable, exportBallotTable, Tooltip Handlers, populatePsListUI, filterPsList, handlePsSelect, updateCandidateColumnsUI, clearCandidateColumnsUI - largely unchanged, check export logic) ---

    /**
     * Updates the Ballot Count table in the UI.
     */
    function updateBallotTableUI() {
        ballotTableBody.innerHTML = '';
        totalAllBallots = 0;

        if (!processedData.length) {
            ballotSummaryLabel.textContent = 'No data loaded or processed.';
            return;
        }

        processedData.forEach((row, index) => {
            totalAllBallots += row.ballotInfo.psTotal;
            const tr = document.createElement('tr');
            tr.dataset.rowIndex = index; // Use index from processedData

            tr.innerHTML = `
                <td>${index + 1}</td>
                <td>${row.psName}</td>
                <td>${row.voters.toLocaleString()}</td>
                <td>${row.ballotInfo.zpcNeeded ? 'Yes' : 'No'}</td>
                <td>${row.ballotInfo.zpcTotal.toLocaleString()}</td>
                <td>${row.ballotInfo.apNeeded ? 'Yes' : 'No'}</td>
                <td>${row.ballotInfo.apTotal.toLocaleString()}</td>
                <td>${row.ballotInfo.wardNeeded ? 'Yes' : 'No'}</td>
                <td>${row.ballotInfo.wardTotal.toLocaleString()}</td>
                <td>${row.ballotInfo.psTotal.toLocaleString()}</td>
            `;
            ballotTableBody.appendChild(tr);
        });

        ballotSummaryLabel.textContent = `Total Ballots Required (all PS): ${totalAllBallots.toLocaleString()}`;
    }

    /**
     * Filters the Ballot Count table based on the search input.
     */
    function filterBallotTable() {
        const searchTerm = ballotSearchInput.value.trim().toLowerCase();
        const rows = ballotTableBody.getElementsByTagName('tr');

        for (const row of rows) {
            const psNameCell = row.cells[1];
            if (psNameCell) {
                const psName = psNameCell.textContent.toLowerCase();
                if (psName.includes(searchTerm)) {
                    row.classList.remove('hidden');
                } else {
                    row.classList.add('hidden');
                }
            }
        }
        // Optional: Recalculate visible total if needed, but export handles visible rows
    }

    /**
     * Exports the current data *visible* in the ballot table view to an Excel file.
     */
     function exportBallotTable() {
        if (!processedData.length) {
            alert("No data available to export.");
            return;
        }

        const dataToExport = [];
        const headers = [
            "No.", "PS Name", "Total Voters", "ZPC Ballot", "Total ZPC Ballots",
            "AP Ballot", "Total AP Ballots", "Ward Ballot", "Total Ward Ballots", "Total Ballots"
        ];
        const rows = ballotTableBody.getElementsByTagName('tr');
        let visibleRowCount = 0;
        let visibleTotalBallots = 0; // Calculate total for visible rows

        for (const row of rows) {
             if (!row.classList.contains('hidden')) { // Only export visible rows
                visibleRowCount++;
                const rowIndex = parseInt(row.dataset.rowIndex, 10); // Get index from data attribute
                 if (rowIndex >= 0 && rowIndex < processedData.length) {
                    const rowData = processedData[rowIndex];
                    visibleTotalBallots += rowData.ballotInfo.psTotal; // Sum totals for visible rows
                    dataToExport.push({
                        [headers[0]]: visibleRowCount,
                        [headers[1]]: rowData.psName,
                        [headers[2]]: rowData.voters,
                        [headers[3]]: rowData.ballotInfo.zpcNeeded ? 'Yes' : 'No',
                        [headers[4]]: rowData.ballotInfo.zpcTotal,
                        [headers[5]]: rowData.ballotInfo.apNeeded ? 'Yes' : 'No',
                        [headers[6]]: rowData.ballotInfo.apTotal,
                        [headers[7]]: rowData.ballotInfo.wardNeeded ? 'Yes' : 'No',
                        [headers[8]]: rowData.ballotInfo.wardTotal,
                        [headers[9]]: rowData.ballotInfo.psTotal
                    });
                 } else {
                      console.warn(`Skipping row during export due to invalid index: ${row.dataset.rowIndex}`);
                 }
             }
        }

        if (!dataToExport.length) {
            alert("No data currently visible in the table to export (check filter?).");
            return;
        }

        // Optional: Add a summary row for the *exported* (visible) data
        dataToExport.push({}); // Empty spacer row
        dataToExport.push({
            [headers[1]]: "Visible Rows Total", // Label for summary
             [headers[9]]: visibleTotalBallots // Sum of 'Total Ballots' for visible rows
         });


        try {
            const ws = XLSX.utils.json_to_sheet(dataToExport, { header: headers });
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Ballot Count Export");
            XLSX.writeFile(wb, "Ballot_Count_Export.xlsx");
        } catch (error) {
            console.error("Error exporting to Excel:", error);
            alert(`An error occurred during export:\n${error.message}`);
        }
    }

    // --- Tooltip Handlers (handleTableMouseOver, handleTableMouseOut, handleTableMouseMove - unchanged) ---
        function handleTableMouseOver(event) {
        const row = event.target.closest('tr');
        if (row && row.dataset.rowIndex !== undefined) {
            const rowIndex = parseInt(row.dataset.rowIndex, 10);
            if (rowIndex >= 0 && rowIndex < processedData.length){
                const rowData = processedData[rowIndex];
                const zpcText = rowData.candidates.zpc.length > 0 ? rowData.candidates.zpc.join(', ') : 'Uncontested or Nil';
                const apText = rowData.candidates.ap.length > 0 ? rowData.candidates.ap.join(', ') : 'Uncontested or Nil';
                const wardText = rowData.candidates.ward.length > 0 ? rowData.candidates.ward.join(', ') : 'Uncontested or Nil';

                const tooltipText = `ZPC Candidates: ${zpcText}\nAP Candidates:  ${apText}\nWard Candidates:${wardText}`;
                tooltipElement.textContent = tooltipText;
                tooltipElement.style.display = 'block';
            } else {
                tooltipElement.style.display = 'none';
            }
        } else {
             tooltipElement.style.display = 'none';
        }
    }

    function handleTableMouseOut(event) {
         const relatedTarget = event.relatedTarget;
         if (!ballotTableBody.contains(relatedTarget) && relatedTarget !== tooltipElement) {
            tooltipElement.style.display = 'none';
         }
    }

    function handleTableMouseMove(event) {
        if (tooltipElement.style.display === 'block') {
            const xOffset = 15;
            const yOffset = 10;
            // Ensure tooltip stays within viewport boundaries (basic example)
            const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
            const scrollY = window.pageYOffset || document.documentElement.scrollTop;
            let left = event.pageX + xOffset;
            let top = event.pageY + yOffset;

            tooltipElement.style.left = `${left}px`;
            tooltipElement.style.top = `${top}px`;

             // Basic boundary check (adjust as needed)
            // const tooltipRect = tooltipElement.getBoundingClientRect();
            // if (left + tooltipRect.width > window.innerWidth + scrollX) {
            //     left = event.pageX - tooltipRect.width - xOffset;
            // }
            // if (top + tooltipRect.height > window.innerHeight + scrollY) {
            //      top = event.pageY - tooltipRect.height - yOffset;
            // }
            // tooltipElement.style.left = `${left}px`;
            // tooltipElement.style.top = `${top}px`;
        }
    }

    // --- Contestant Names UI Functions (populatePsListUI, filterPsList, handlePsSelect, updateCandidateColumnsUI, clearCandidateColumnsUI - unchanged) ---
    function populatePsListUI() {
        psList.innerHTML = '';
        psSearchInput.value = '';

        if (!psNames.length) return;

        psNames.forEach((name) => { // No index needed if using psName directly
            const li = document.createElement('li');
            li.textContent = name;
            li.dataset.psName = name; // Store name in data attribute
            psList.appendChild(li);
        });
    }

    function filterPsList() {
        const searchTerm = psSearchInput.value.trim().toLowerCase();
        const items = psList.getElementsByTagName('li');

        for (const item of items) {
            const psName = item.textContent.toLowerCase();
            if (psName.includes(searchTerm)) {
                item.classList.remove('hidden');
            } else {
                item.classList.add('hidden');
            }
        }
    }

    function handlePsSelect(event) {
        if (event.target.tagName === 'LI') {
            const selectedLi = event.target;
            const psName = selectedLi.dataset.psName;

             const previouslySelected = psList.querySelector('.selected');
             if (previouslySelected) {
                 previouslySelected.classList.remove('selected');
             }
             selectedLi.classList.add('selected');

            if (psName && psNameToIndexMap.hasOwnProperty(psName)) {
                const index = psNameToIndexMap[psName];
                if(index >= 0 && index < processedData.length){
                    const rowData = processedData[index];
                    updateCandidateColumnsUI(rowData.candidates);
                } else {
                    console.error(`Data index out of bounds for PS Name: ${psName} at index ${index}`);
                    clearCandidateColumnsUI();
                }
            } else {
                 console.error(`Could not find map entry for PS Name: ${psName}`);
                 clearCandidateColumnsUI();
            }
        }
    }


    function updateCandidateColumnsUI(candidates) {
        clearCandidateColumnsUI();

        function populateList(listElement, candidateArray) {
            if (candidateArray && candidateArray.length > 0) {
                candidateArray.forEach(name => {
                    const li = document.createElement('li');
                    li.textContent = name;
                    listElement.appendChild(li);
                });
            } else {
                const li = document.createElement('li');
                li.textContent = 'Uncontested or Nil';
                li.classList.add('uncontested');
                listElement.appendChild(li);
            }
        }

        populateList(zpcCandidateList, candidates.zpc);
        populateList(apCandidateList, candidates.ap);
        populateList(wardCandidateList, candidates.ward);
    }

    function clearCandidateColumnsUI() {
        zpcCandidateList.innerHTML = '';
        apCandidateList.innerHTML = '';
        wardCandidateList.innerHTML = '';
    }


    // --- UI State Management ---

    /**
     * Switches the visible UI view.
     */
    function switchView() {
        if (currentView === 'ballot_count') {
            ballotCountView.classList.remove('active-view');
            contestantNamesView.classList.add('active-view');
            currentView = 'contestant_names';
            switchViewButton.textContent = 'Switch to Ballot Count View';
            document.title = 'Polling Station Candidate Viewer';
        } else {
            contestantNamesView.classList.remove('active-view');
            ballotCountView.classList.add('active-view');
            currentView = 'ballot_count';
            switchViewButton.textContent = 'Switch to Contestant View';
             document.title = 'Ballot Paper Requirements';
        }
    }

     /**
      * Enables UI controls after data is loaded successfully.
      */
     function enableControls() {
         // Enable buttons regardless of data presence if needed,
         // but inputs/export usually depend on data
         loadFromUrlButton.disabled = false;
         fileInput.disabled = false; // Re-enable file input label indirectly

         if (processedData && processedData.length > 0) {
             exportButton.disabled = false;
             ballotSearchInput.disabled = false;
             ballotSearchButton.disabled = false;
             psSearchInput.disabled = false;
         } else {
             // Keep data-dependent controls disabled if no data processed
             exportButton.disabled = true;
             ballotSearchInput.disabled = true;
             ballotSearchButton.disabled = true;
             psSearchInput.disabled = true;
         }
     }

     /**
      * Disables UI controls (e.g., during loading or on error).
      */
     function disableControls() {
         loadFromUrlButton.disabled = true;
         fileInput.disabled = true; // Disable file input indirectly
         exportButton.disabled = true;
         ballotSearchInput.disabled = true;
         ballotSearchButton.disabled = true;
         psSearchInput.disabled = true;
         // Clear search inputs when disabling
         // ballotSearchInput.value = '';
         // psSearchInput.value = '';
     }

    /**
     * Resets the application state (clears data, UI, disables controls).
     */
     function resetApplicationState() {
         rawData = [];
         processedData = [];
         psNames = [];
         psNameToIndexMap = {};
         totalAllBallots = 0;
         isLoading = false; // Ensure loading flag is reset

         // Clear UI elements
         resetUIOnly(); // Use the UI clearing part
         ballotSummaryLabel.textContent = 'Load data to see totals.';
         statusLabel.textContent = 'No data loaded.';
         googleSheetUrlInput.value = ''; // Clear URL input
         ballotSearchInput.value = ''; // Clear search
         psSearchInput.value = '';    // Clear search

         disableControls(); // Disable buttons/inputs
     }


    // --- Initial Setup ---
    disableControls(); // Start with controls disabled
    // Set initial title (optional, can rely on HTML)
    document.title = 'Ballot Paper Requirements';

}); // End DOMContentLoaded
