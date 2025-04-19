document.addEventListener('DOMContentLoaded', () => {
    // --- Global State ---
    let rawData = []; // Data directly from Excel sheet
    let processedData = []; // Cleaned and processed data used by UIs
    let psNames = []; // Unique, sorted PS names
    let psNameToIndexMap = {}; // Map PS name to index in processedData
    let currentView = 'ballot_count'; // 'ballot_count' or 'contestant_names'
    let totalAllBallots = 0;

    // --- DOM Element References ---
    const fileInput = document.getElementById('excelFile');
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

    // --- Utility Functions ---

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
            // Check if key exists, is a string, and starts with the prefix
            if (Object.hasOwnProperty.call(row, key) && typeof key === 'string' && key.startsWith(prefix)) {
                let value = row[key];
                // Check if value is not null/undefined
                if (value !== null && value !== undefined) {
                    // Convert to string, trim, check if not empty and not 'nil' (case-insensitive)
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
     * Handles strings, numbers, and potential float strings like "150.0".
     * @param {*} value - The value to convert.
     * @returns {number} - The integer value or 0.
     */
    function safeParseInt(value) {
        if (value === null || value === undefined || String(value).trim() === '') {
            return 0;
        }
        const num = Number(String(value).trim()); // Try converting to number directly
        return Number.isFinite(num) ? Math.floor(num) : 0; // Floor it if finite, else 0
    }

    // --- Event Listeners ---
    fileInput.addEventListener('change', handleFileLoad);
    switchViewButton.addEventListener('click', switchView);
    exportButton.addEventListener('click', exportBallotTable);
    ballotSearchButton.addEventListener('click', filterBallotTable);
    ballotSearchInput.addEventListener('input', filterBallotTable); // Filter as user types
    psSearchInput.addEventListener('input', filterPsList); // Filter as user types
    psList.addEventListener('click', handlePsSelect);

    // Tooltip listeners for ballot table (using event delegation)
    ballotTableBody.addEventListener('mouseover', handleTableMouseOver);
    ballotTableBody.addEventListener('mouseout', handleTableMouseOut);
    ballotTableBody.addEventListener('mousemove', handleTableMouseMove);


    // --- Core Logic Functions ---

    /**
     * Handles the loading and processing of the selected Excel file.
     */
    function handleFileLoad(event) {
        const file = event.target.files[0];
        if (!file) {
            statusLabel.textContent = 'No file selected.';
            return;
        }

        statusLabel.textContent = 'Loading file...';
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });

                const sheetName = workbook.SheetNames[0]; // Assume data is on the first sheet
                if (!sheetName) {
                    throw new Error("Excel file seems empty or has no sheets.");
                }
                // Convert sheet to JSON array of objects
                // Use defval: '' to ensure empty cells become empty strings, not undefined
                rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });

                if (!rawData.length) {
                     throw new Error("Sheet 'Sheet1' is empty or could not be read.");
                }
                 // Check for 'PS Name' column (case-insensitive check is safer)
                 const headers = Object.keys(rawData[0] || {});
                 const psNameHeader = headers.find(h => h.trim().toLowerCase() === 'ps name');
                 if (!psNameHeader) {
                     throw new Error("Required column 'PS Name' not found in the sheet.");
                 }


                // --- Process Raw Data ---
                processRawData(rawData, psNameHeader); // Pass the actual header found

                // --- Update UIs ---
                updateBallotTableUI();
                populatePsListUI();

                statusLabel.textContent = `Loaded ${processedData.length} unique PS from: ${file.name}`;
                enableControls(); // Enable buttons and inputs now that data is loaded

            } catch (error) {
                console.error("Error processing Excel file:", error);
                statusLabel.textContent = `Error: ${error.message}`;
                alert(`Error loading or processing file:\n${error.message}\n\nPlease ensure the file is a valid Excel file, contains a 'Sheet1', and has a 'PS Name' column.`);
                resetApplicationState(); // Clear data and disable controls on error
            } finally {
                // Reset file input to allow reloading the same file if needed
                 fileInput.value = '';
            }
        };

        reader.onerror = (e) => {
            console.error("FileReader error:", e);
            statusLabel.textContent = 'Error reading file.';
            alert("An error occurred while trying to read the file.");
            resetApplicationState();
        };

        reader.readAsArrayBuffer(file); // Read file as ArrayBuffer
    }

     /**
     * Cleans raw data, handles duplicates, calculates necessary values.
     * @param {object[]} rawJsonData - Data array from SheetJS.
     * @param {string} psNameKey - The exact key found for 'PS Name'.
     */
    function processRawData(rawJsonData, psNameKey) {
        processedData = [];
        psNameToIndexMap = {};
        psNames = [];
        const seenPsNames = new Set(); // Keep track of PS Names already added

        rawJsonData.forEach((rawRow, index) => {
            const originalPsName = String(rawRow[psNameKey] || '').trim();

            // Skip rows with empty PS Name after trimming
            if (!originalPsName) {
                console.warn(`Skipping row ${index + 2} due to empty PS Name.`);
                return;
            }

             // Handle potential duplicate PS names: only process the first occurrence
            if (seenPsNames.has(originalPsName)) {
                console.warn(`Skipping duplicate PS Name: "${originalPsName}" at row ${index + 2}.`);
                return;
            }
            seenPsNames.add(originalPsName);


            const processedRow = {
                originalIndex: index, // Keep track of original row for potential debugging
                psName: originalPsName,
                voters: safeParseInt(rawRow['Total Number of Voter']), // Use the exact header or make configurable
                candidates: {}, // Store extracted candidates here
                ballotInfo: {} // Store ballot calculation results here
            };

            // Extract candidates
            processedRow.candidates.zpc = getCandidateNamesJS(rawRow, 'ZPM');
            processedRow.candidates.ap = getCandidateNamesJS(rawRow, 'APM');
            processedRow.candidates.ward = getCandidateNamesJS(rawRow, 'GPM');

            // Calculate ballot requirements and totals
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

         // Sort processed data by PS Name for consistent display
        processedData.sort((a, b) => a.psName.localeCompare(b.psName));

        // Create map and names list *after* sorting and processing unique names
        processedData.forEach((row, newIndex) => {
             psNames.push(row.psName);
             psNameToIndexMap[row.psName] = newIndex; // Map name to its index in the *processedData* array
        });
    }

    /**
     * Updates the Ballot Count table in the UI.
     */
    function updateBallotTableUI() {
        ballotTableBody.innerHTML = ''; // Clear existing rows
        totalAllBallots = 0;

        if (!processedData.length) {
            ballotSummaryLabel.textContent = 'No data loaded or processed.';
            return;
        }

        processedData.forEach((row, index) => {
            totalAllBallots += row.ballotInfo.psTotal;

            const tr = document.createElement('tr');
            // Store the index of the row in processedData for easy lookup (e.g., for tooltips)
            tr.dataset.rowIndex = index;

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
            const psNameCell = row.cells[1]; // PS Name is the second cell (index 1)
            if (psNameCell) {
                const psName = psNameCell.textContent.toLowerCase();
                if (psName.includes(searchTerm)) {
                    row.classList.remove('hidden'); // Show row
                } else {
                    row.classList.add('hidden'); // Hide row
                }
            }
        }
    }

    /**
     * Exports the current data in the ballot table view to an Excel file.
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

        // Iterate through VISIBLE rows if filtering is applied, or all rows otherwise
        const rows = ballotTableBody.getElementsByTagName('tr');
        let visibleRowCount = 0;

        for (const row of rows) {
             // Check if the row is currently visible (not hidden by filter)
             if (!row.classList.contains('hidden')) {
                visibleRowCount++;
                const rowIndex = parseInt(row.dataset.rowIndex, 10);
                const rowData = processedData[rowIndex];

                 if(rowData){ // Ensure data exists for the index
                    dataToExport.push({
                        [headers[0]]: visibleRowCount, // Use visible row count for "No."
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
                 }
             }
        }

         // Add summary row if needed (optional)
         // dataToExport.push({}); // Empty row spacer
         // dataToExport.push({ [headers[1]]: "Grand Total", [headers[9]]: totalAllBallots });


        if (!dataToExport.length) {
            alert("No visible data to export (check filter?).");
            return;
        }

        try {
            // Create worksheet
            const ws = XLSX.utils.json_to_sheet(dataToExport, { header: headers }); // Specify headers to ensure order

            // Optional: Adjust column widths (more advanced)
            // const columnWidths = [{wch:5}, {wch:30}, {wch:10}, {wch:10}, {wch:15}, {wch:10}, {wch:15}, {wch:10}, {wch:15}, {wch:15}];
            // ws['!cols'] = columnWidths;

            // Create workbook
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Ballot Count Export");

            // Trigger download
            XLSX.writeFile(wb, "Ballot_Count_Export.xlsx");

        } catch (error) {
            console.error("Error exporting to Excel:", error);
            alert(`An error occurred during export:\n${error.message}`);
        }
    }

    // --- Tooltip Handlers ---
    function handleTableMouseOver(event) {
        const row = event.target.closest('tr');
        if (row && row.dataset.rowIndex !== undefined) {
            const rowIndex = parseInt(row.dataset.rowIndex, 10);
            const rowData = processedData[rowIndex];
            if (rowData) {
                const zpcText = rowData.candidates.zpc.length > 0 ? rowData.candidates.zpc.join(', ') : 'Uncontested or Nil';
                const apText = rowData.candidates.ap.length > 0 ? rowData.candidates.ap.join(', ') : 'Uncontested or Nil';
                const wardText = rowData.candidates.ward.length > 0 ? rowData.candidates.ward.join(', ') : 'Uncontested or Nil';

                const tooltipText = `ZPC Candidates: ${zpcText}\nAP Candidates:  ${apText}\nWard Candidates:${wardText}`;
                tooltipElement.textContent = tooltipText;
                tooltipElement.style.display = 'block';
                // Position will be updated by mousemove
            }
        } else {
             tooltipElement.style.display = 'none'; // Hide if not over a valid row
        }
    }

    function handleTableMouseOut(event) {
        // Hide tooltip when mouse leaves the table body or the row itself
         const relatedTarget = event.relatedTarget;
         // Check if the mouse is still within the table body or moving to the tooltip itself
         if (!ballotTableBody.contains(relatedTarget) && relatedTarget !== tooltipElement) {
            tooltipElement.style.display = 'none';
         }
    }

    function handleTableMouseMove(event) {
        if (tooltipElement.style.display === 'block') {
            // Position tooltip slightly offset from the mouse cursor
            // Adjust offsets as needed
            const xOffset = 15;
            const yOffset = 10;
            tooltipElement.style.left = `${event.pageX + xOffset}px`;
            tooltipElement.style.top = `${event.pageY + yOffset}px`;
        }
    }


    // --- Contestant Names UI Functions ---

    /**
     * Populates the PS list in the Contestant Names UI.
     */
    function populatePsListUI() {
        psList.innerHTML = ''; // Clear existing list
        psSearchInput.value = ''; // Clear search

        if (!psNames.length) return;

        psNames.forEach((name, index) => {
            const li = document.createElement('li');
            li.textContent = name;
            // Store the original PS name or its index in processedData for easy lookup on click
            li.dataset.psName = name;
            psList.appendChild(li);
        });
    }

    /**
     * Filters the PS list based on the search input.
     */
    function filterPsList() {
        const searchTerm = psSearchInput.value.trim().toLowerCase();
        const items = psList.getElementsByTagName('li');

        for (const item of items) {
            const psName = item.textContent.toLowerCase();
            if (psName.includes(searchTerm)) {
                item.classList.remove('hidden'); // Show item
            } else {
                item.classList.add('hidden'); // Hide item
            }
        }
    }

    /**
     * Handles the selection of a PS from the list.
     */
    function handlePsSelect(event) {
        if (event.target.tagName === 'LI') {
            const selectedLi = event.target;
            const psName = selectedLi.dataset.psName;

             // Remove selected class from previously selected item
             const previouslySelected = psList.querySelector('.selected');
             if (previouslySelected) {
                 previouslySelected.classList.remove('selected');
             }
             // Add selected class to the clicked item
             selectedLi.classList.add('selected');


            if (psName && psNameToIndexMap.hasOwnProperty(psName)) {
                const index = psNameToIndexMap[psName];
                const rowData = processedData[index];
                if (rowData) {
                    updateCandidateColumnsUI(rowData.candidates);
                } else {
                     console.error(`Data not found for PS Name: ${psName} at index ${index}`);
                     clearCandidateColumnsUI(); // Clear display on error
                }
            } else {
                 console.error(`Could not find map entry for PS Name: ${psName}`);
                 clearCandidateColumnsUI(); // Clear display if name not found in map
            }
        }
    }


    /**
     * Updates the candidate columns in the Contestant Names UI.
     * @param {object} candidates - Object containing zpc, ap, ward candidate arrays.
     */
    function updateCandidateColumnsUI(candidates) {
        clearCandidateColumnsUI(); // Clear previous content

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

     /**
     * Clears the candidate list columns in the Contestant Names UI.
     */
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
            document.title = 'Polling Station Candidate Viewer'; // Update page title
        } else {
            contestantNamesView.classList.remove('active-view');
            ballotCountView.classList.add('active-view');
            currentView = 'ballot_count';
            switchViewButton.textContent = 'Switch to Contestant View';
             document.title = 'Ballot Paper Requirements'; // Update page title
        }
    }

     /**
      * Enables UI controls after data is loaded.
      */
     function enableControls() {
         exportButton.disabled = false;
         ballotSearchInput.disabled = false;
         ballotSearchButton.disabled = false;
         psSearchInput.disabled = false;
         // psList interaction is handled via event listener, no need to disable/enable the UL itself
     }

     /**
      * Disables UI controls and clears data (e.g., on error).
      */
     function disableControls() {
         exportButton.disabled = true;
         ballotSearchInput.disabled = true;
         ballotSearchButton.disabled = true;
         ballotSearchInput.value = ''; // Clear search
         psSearchInput.disabled = true;
         psSearchInput.value = ''; // Clear search
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

         // Clear UI elements
         ballotTableBody.innerHTML = '';
         psList.innerHTML = '';
         clearCandidateColumnsUI();
         ballotSummaryLabel.textContent = 'Load data to see totals.';
         statusLabel.textContent = 'No file loaded.';
         tooltipElement.style.display = 'none'; // Hide tooltip

         disableControls(); // Disable buttons/inputs
     }


    // --- Initial Setup ---
    // Set the initial view (optional, default is ballot count as per HTML)
    // switchView(); // Call only if you want the initial view to be different
    // Initial state is controls disabled
    disableControls();

}); // End DOMContentLoaded
