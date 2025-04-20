document.addEventListener('DOMContentLoaded', () => {
    // --- Global State ---
    let rawData = [];
    let processedData = [];
    let psNames = [];
    let psNameToIndexMap = {};
    let currentView = 'ballot_count';
    let totalAllBallots = 0;
    let isLoading = false; // Flag to prevent concurrent loading

    // --- DOM Element References ---
    const fileInput = document.getElementById('excelFile');
    const fileInputLabel = document.querySelector('label[for="excelFile"]'); // Get label for styling
    const googleSheetUrlInput = document.getElementById('googleSheetUrl');
    const loadFromUrlButton = document.getElementById('loadFromUrlButton');
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
    function safeParseInt(value) {
        if (value === null || value === undefined || String(value).trim() === '') return 0;
        const num = Number(String(value).trim());
        return Number.isFinite(num) ? Math.floor(num) : 0;
    }
    /**
    * Helper to find a value in an object using a case-insensitive key.
    */
    function findValueCaseInsensitive(obj, targetKey) {
        if (!obj || typeof targetKey !== 'string') return undefined;
        const lowerTargetKey = targetKey.toLowerCase();
        for (const key in obj) {
            if (Object.hasOwnProperty.call(obj, key) && String(key).toLowerCase() === lowerTargetKey) {
                return obj[key];
            }
        }
        return undefined;
    }


    // --- Event Listeners ---
    fileInput.addEventListener('change', handleFileLoad);
    loadFromUrlButton.addEventListener('click', handleUrlLoad);
    switchViewButton.addEventListener('click', switchView);
    exportButton.addEventListener('click', exportBallotTable);
    ballotSearchButton.addEventListener('click', filterBallotTable);
    ballotSearchInput.addEventListener('input', filterBallotTable); // Filter as user types
    psSearchInput.addEventListener('input', filterPsList);
    psList.addEventListener('click', handlePsSelect);
    ballotTableBody.addEventListener('mouseover', handleTableMouseOver);
    ballotTableBody.addEventListener('mouseout', handleTableMouseOut);
    ballotTableBody.addEventListener('mousemove', handleTableMouseMove);

    // --- Core Logic Functions ---

    /**
     * Starts the loading process, updates UI accordingly.
     */
    function startLoading(message = 'Loading data...') {
        if (isLoading) {
            console.warn("Already loading data.");
            return false;
        }
        isLoading = true;
        statusLabel.textContent = message;
        setControlsState(true); // Disable controls *during* load
        resetUIOnly();
        return true;
    }

    /**
     * Ends the loading process, updates UI accordingly.
     */
    function endLoading() {
        isLoading = false;
        setControlsState(false); // Set controls state based on data presence *after* load
        fileInput.value = ''; // Reset file input value so same file can be reloaded
    }

    /**
     * Clears UI elements without resetting the underlying data state.
     */
    function resetUIOnly() {
        ballotTableBody.innerHTML = '';
        psList.innerHTML = '';
        clearCandidateColumnsUI();
        ballotSummaryLabel.textContent = 'Processing...';
        tooltipElement.style.display = 'none';
    }

    /**
     * Resets the application state (clears data, UI, disables controls).
     * @param {boolean} [clearStatus=true] - Whether to reset the status label.
     */
     function resetApplicationState(clearStatus = true) {
         rawData = [];
         processedData = [];
         psNames = [];
         psNameToIndexMap = {};
         totalAllBallots = 0;
         // isLoading should be reset by endLoading

         resetUIOnly(); // Clear UI tables/lists
         ballotSummaryLabel.textContent = 'Load data to see totals.';
         googleSheetUrlInput.value = '';
         ballotSearchInput.value = '';
         psSearchInput.value = '';

         if (clearStatus) {
            statusLabel.textContent = 'No data loaded.';
         }

         setControlsState(isLoading); // Update controls based on current loading state (usually false after reset)
     }


    /**
     * Handles loading local Excel file.
     */
    function handleFileLoad(event) {
        const file = event.target.files[0];
        if (!file) return;
        if (!startLoading(`Loading file: ${file.name}...`)) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                if (!sheetName) throw new Error("Excel file has no sheets.");
                const rawJson = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
                if (!rawJson.length) throw new Error(`Sheet '${sheetName}' is empty or only has headers.`);
                const headers = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 })[0];
                if(!headers || headers.length === 0) throw new Error("Could not read headers from the sheet.");

                // Find the 'PS Name' header case-insensitively
                const psNameHeader = headers.find(h => typeof h === 'string' && h.trim().toLowerCase() === 'ps name');
                if (!psNameHeader) throw new Error("Required column 'PS Name' not found.");

                rawData = rawJson; // Keep the raw JSON from SheetJS
                processRawData(rawData, psNameHeader); // Pass the exact header string found
                updateAllUIs();
                statusLabel.textContent = `Loaded ${processedData.length} unique PS from: ${file.name}`;
            } catch (error) {
                handleLoadingError(error, "Error processing Excel file");
            } finally {
                endLoading();
            }
        };
        reader.onerror = (e) => {
            console.error("FileReader error:", e);
            handleLoadingError(new Error("An error occurred while trying to read the file."), "File Read Error");
            endLoading(); // Ensure loading state is reset even on reader error
        };
        reader.readAsArrayBuffer(file);
    }

    /**
     * Handles loading data from Google Sheet URL.
     */
    async function handleUrlLoad() {
        const url = googleSheetUrlInput.value.trim();
        if (!url) {
            alert("Please paste a Google Sheet 'Publish to web' CSV URL first.");
            return;
        }

        // --- Relaxed URL Check ---
        if (!url.includes('/pub?') || !url.includes('output=csv')) {
             console.warn("URL format might be incorrect. Expected a Google Sheet 'Publish to web' CSV link (containing '/pub?' and 'output=csv'). Attempting to load anyway...");
        }

        if (!startLoading(`Loading from URL...`)) return;

        try {
            // *** IMPLEMENTED METHOD 1: Use cache: 'no-store' fetch option ***
            const response = await fetch(url, { cache: 'no-store' });
            // *****************************************************************

            if (!response.ok) {
                throw new Error(`Failed to fetch data. Status: ${response.status} ${response.statusText}. Ensure the link is correct and published publicly.`);
            }
            const csvText = await response.text();
            if (!csvText) {
                 throw new Error("Fetched data is empty. Check the Google Sheet or link.");
            }

            // Use SheetJS to parse the CSV string
            const workbook = XLSX.read(csvText, { type: 'string', raw: true }); // raw:true important for header finding
            const sheetName = workbook.SheetNames[0];
            if (!sheetName) throw new Error("Could not parse CSV data.");

            const rawJson = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
            if (!rawJson.length) throw new Error("CSV data is empty after parsing (no data rows).");

            const headers = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 })[0];
            if(!headers || headers.length === 0) throw new Error("Could not read headers from the CSV data.");

            // Find the 'PS Name' header case-insensitively
            const psNameHeader = headers.find(h => typeof h === 'string' && h.trim().toLowerCase() === 'ps name');
            if (!psNameHeader) throw new Error("Required column 'PS Name' not found in the CSV data.");

            rawData = rawJson; // Keep the raw JSON from SheetJS
            processRawData(rawData, psNameHeader); // Pass the exact header string found
            updateAllUIs();
            statusLabel.textContent = `Loaded ${processedData.length} unique PS from URL.`;

        } catch (error) {
             handleLoadingError(error, "Error loading from URL");
        } finally {
            endLoading();
        }
    }

    /**
     * Centralized error handling for loading processes.
     */
    function handleLoadingError(error, contextMessage = "Error") {
         console.error(`${contextMessage}:`, error);
         // Try to provide a more specific error message if possible
         let userMessage = error.message || "An unknown error occurred.";
         if (error.message && error.message.includes("fetch")) {
             userMessage = `Network or fetch error: ${error.message}. Check the URL, your internet connection, and ensure the sheet is published correctly.`;
         } else if (error.message && error.message.includes("'PS Name' not found")) {
            userMessage = `Data structure error: ${error.message}. Verify the sheet has a column named 'PS Name'.`;
         } else if (error.message && error.message.includes("sheet")) {
             userMessage = `File structure error: ${error.message}. Ensure the file/sheet is valid and not empty.`;
         }
         statusLabel.textContent = `Error: ${userMessage}`;
         alert(`${contextMessage}:\n${userMessage}`);
         resetApplicationState(false); // Reset state but keep load buttons enabled
    }


     /**
     * Cleans raw data, handles duplicates, calculates necessary values.
     * @param {object[]} sourceData - Data array from SheetJS (JSON).
     * @param {string} psNameKey - The exact key found for 'PS Name'.
     */
    function processRawData(sourceData, psNameKey) {
        processedData = [];
        psNameToIndexMap = {};
        psNames = [];
        const seenPsNames = new Set();

        sourceData.forEach((rawRow, index) => {
            // Use the exact key found during header check
            const originalPsName = String(rawRow[psNameKey] || '').trim();
            if (!originalPsName) {
                // console.warn(`Skipping row ${index + 2} (source) due to empty PS Name.`);
                return;
            }
            // Make comparison case-insensitive for duplicate checking
            const lowerCasePsName = originalPsName.toLowerCase();
            if (seenPsNames.has(lowerCasePsName)) {
                console.warn(`Skipping duplicate PS Name (case-insensitive): "${originalPsName}" at source row index ${index}.`);
                return;
            }
            seenPsNames.add(lowerCasePsName);

            const processedRow = {
                originalIndex: index,
                psName: originalPsName, // Store the original casing
                voters: safeParseInt(findValueCaseInsensitive(rawRow, 'Total Number of Voter') || '0'),
                candidates: {},
                ballotInfo: {}
            };

            // Use case-insensitive find for candidate prefixes as well
            processedRow.candidates.zpc = getCandidateNamesJSCaseInsensitive(rawRow, 'zpm'); // Use lowercase prefix
            processedRow.candidates.ap = getCandidateNamesJSCaseInsensitive(rawRow, 'apm');
            processedRow.candidates.ward = getCandidateNamesJSCaseInsensitive(rawRow, 'gpm');

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

        // Sort by original PS Name for consistent display
        processedData.sort((a, b) => a.psName.localeCompare(b.psName, undefined, { sensitivity: 'base' }));

        // Rebuild index map after sorting
        psNameToIndexMap = {};
        psNames = [];
        processedData.forEach((row, newIndex) => {
             psNames.push(row.psName);
             // Use original PS name for the map key
             psNameToIndexMap[row.psName] = newIndex;
        });
    }

    /**
    * Case-insensitive version of getCandidateNamesJS
    */
    function getCandidateNamesJSCaseInsensitive(row, lowerCasePrefix) {
        const candidates = [];
        if (!row || typeof lowerCasePrefix !== 'string') return candidates;
        for (const key in row) {
            if (Object.hasOwnProperty.call(row, key) && typeof key === 'string' && key.toLowerCase().startsWith(lowerCasePrefix)) {
                 let value = row[key];
                if (value !== null && value !== undefined) {
                    const strValue = String(value).trim();
                    // Check for empty string or 'nil' (case-insensitive)
                    if (strValue && strValue.toLowerCase() !== 'nil') {
                        candidates.push(strValue);
                    }
                }
            }
        }
        return candidates;
    }

    /**
     * Central function to trigger updates for both UI views.
     */
     function updateAllUIs() {
         updateBallotTableUI();
         populatePsListUI();
         clearCandidateColumnsUI();
         // Clear selection in PS list when new data is loaded
         const previouslySelected = psList.querySelector('.selected');
         if (previouslySelected) {
             previouslySelected.classList.remove('selected');
         }
     }

    // --- UI Update Functions ---
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
            tr.dataset.rowIndex = index; // Use the current index in the processedData array
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

    function filterBallotTable() {
        const searchTerm = ballotSearchInput.value.trim().toLowerCase();
        const rows = ballotTableBody.getElementsByTagName('tr');
        let visibleCount = 0;
        for (const row of rows) {
            const psNameCell = row.cells[1]; // PS Name is the second cell (index 1)
            if (psNameCell) {
                const psName = psNameCell.textContent.toLowerCase();
                const isVisible = psName.includes(searchTerm);
                row.classList.toggle('hidden', !isVisible);
                 if(isVisible) visibleCount++;
            } else {
                row.classList.add('hidden'); // Hide rows that somehow lack a PS name cell
            }
        }
        // Optional: Update summary label based on filter?
        // ballotSummaryLabel.textContent = `Showing ${visibleCount} PS matching filter. Total Ballots (all): ${totalAllBallots.toLocaleString()}`;
    }

    function handleTableMouseOver(event) {
        const cell = event.target.closest('td');
        const row = cell ? cell.closest('tr') : null;

        if (row && row.dataset.rowIndex !== undefined) {
            const rowIndex = parseInt(row.dataset.rowIndex, 10);
            // Ensure the index is valid for the *current* processedData array
            if (!isNaN(rowIndex) && rowIndex >= 0 && rowIndex < processedData.length){
                const rowData = processedData[rowIndex];
                // Check if candidates exist before joining
                const zpcText = rowData.candidates.zpc && rowData.candidates.zpc.length > 0
                    ? rowData.candidates.zpc.join('\n - ') : 'Uncontested or Nil';
                const apText = rowData.candidates.ap && rowData.candidates.ap.length > 0
                    ? rowData.candidates.ap.join('\n - ') : 'Uncontested or Nil';
                const wardText = rowData.candidates.ward && rowData.candidates.ward.length > 0
                    ? rowData.candidates.ward.join('\n - ') : 'Uncontested or Nil';

                tooltipElement.innerHTML = `<strong>${rowData.psName}</strong><br>---<br>` +
                                          `ZPC Candidates:<br> - ${zpcText}<br>---<br>` +
                                          `AP Candidates:<br> - ${apText}<br>---<br>` +
                                          `Ward Candidates:<br> - ${wardText}`;
                tooltipElement.style.display = 'block';
                // Position calculation moved to mousemove for accuracy
            } else {
                 console.warn(`Invalid rowIndex ${rowIndex} found on row.`);
                 tooltipElement.style.display = 'none';
            }
        } else {
             tooltipElement.style.display = 'none';
        }
    }

    function handleTableMouseOut(event) {
         // Hide tooltip if mouse leaves the table body *entirely*
         const relatedTarget = event.relatedTarget;
         if (!ballotTableBody.contains(relatedTarget) && relatedTarget !== tooltipElement) {
            tooltipElement.style.display = 'none';
         }
    }

    function handleTableMouseMove(event) {
        if (tooltipElement.style.display === 'block') {
            // Standard offset from cursor
            const xOffset = 15;
            const yOffset = 10;

            // Get viewport dimensions
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            // Get tooltip dimensions (might need slight delay if content changes size drastically)
            const tooltipRect = tooltipElement.getBoundingClientRect();

            // Calculate potential positions
            let top = event.pageY + yOffset;
            let left = event.pageX + xOffset;

            // Adjust if tooltip goes off-screen bottom
            if (top + tooltipRect.height > viewportHeight + window.scrollY) {
                top = event.pageY - tooltipRect.height - yOffset; // Place above cursor
            }

            // Adjust if tooltip goes off-screen right
            if (left + tooltipRect.width > viewportWidth + window.scrollX) {
                left = event.pageX - tooltipRect.width - xOffset; // Place left of cursor
            }

             // Ensure it doesn't go off-screen top or left (less common)
             if (top < window.scrollY) {
                 top = window.scrollY + 5; // Add small buffer from top edge
             }
             if (left < window.scrollX) {
                 left = window.scrollX + 5; // Add small buffer from left edge
             }


            tooltipElement.style.left = `${left}px`;
            tooltipElement.style.top = `${top}px`;
        }
    }

    function populatePsListUI() {
        psList.innerHTML = '';
        psSearchInput.value = ''; // Clear search when list repopulates
        if (!psNames.length) {
            psList.innerHTML = '<li>No polling stations loaded.</li>'; // Placeholder message
            return;
        }
        psNames.forEach((name) => {
            const li = document.createElement('li');
            li.textContent = name;
            li.dataset.psName = name; // Store original name for lookup
            psList.appendChild(li);
        });
    }

    function filterPsList() {
        const searchTerm = psSearchInput.value.trim().toLowerCase();
        const items = psList.getElementsByTagName('li');
        let hasVisibleItems = false;
        for (const item of items) {
            // Ensure the item has a psName dataset attribute before proceeding
            if (item.dataset.psName) {
                const psName = item.dataset.psName.toLowerCase();
                const isVisible = psName.includes(searchTerm);
                item.classList.toggle('hidden', !isVisible);
                if (isVisible) hasVisibleItems = true;
            } else {
                 // Hide placeholder or malformed items
                item.classList.add('hidden');
            }
        }
         // Optional: Show a message if the filter hides everything
         // Add a placeholder element in HTML if needed: <li id="psListNoResults" class="hidden">No matching PS found.</li>
         // const noResultsLi = document.getElementById('psListNoResults');
         // if (noResultsLi) noResultsLi.classList.toggle('hidden', hasVisibleItems);
    }

    function handlePsSelect(event) {
        if (event.target.tagName === 'LI' && event.target.dataset.psName) { // Ensure it's a valid PS list item
            const selectedLi = event.target;
            const psName = selectedLi.dataset.psName; // Get the original PS name

            // Deselect previous
            const previouslySelected = psList.querySelector('.selected');
            if (previouslySelected) previouslySelected.classList.remove('selected');

            // Select current
            selectedLi.classList.add('selected');

            // Find the corresponding data using the map
            if (psName && psNameToIndexMap.hasOwnProperty(psName)) {
                const index = psNameToIndexMap[psName];
                if(index >= 0 && index < processedData.length){
                    updateCandidateColumnsUI(processedData[index].candidates);
                } else {
                    console.error(`Index ${index} from map is out of bounds for processedData (length ${processedData.length}).`);
                    clearCandidateColumnsUI();
                }
            } else {
                 console.error(`PS Name "${psName}" not found in psNameToIndexMap.`);
                 clearCandidateColumnsUI(); // Clear columns if PS name not found
            }
        }
    }

    function updateCandidateColumnsUI(candidates) {
        clearCandidateColumnsUI(); // Clear previous content first

        const populateList = (listElement, candidateArray) => {
            if (candidateArray && candidateArray.length > 0) {
                candidateArray.forEach(name => {
                    const li = document.createElement('li');
                    li.textContent = name; // Use textContent for safety
                    listElement.appendChild(li);
                });
            } else {
                // Use a specific class for styling 'uncontested'
                listElement.insertAdjacentHTML('beforeend', `<li class="uncontested">Uncontested or Nil</li>`);
            }
        };

        // Ensure 'candidates' object exists before accessing its properties
        if (candidates) {
            populateList(zpcCandidateList, candidates.zpc);
            populateList(apCandidateList, candidates.ap);
            populateList(wardCandidateList, candidates.ward);
        } else {
            // Handle case where candidate data might be missing for a selected PS
             const placeholder = `<li class="uncontested">Data unavailable</li>`;
             zpcCandidateList.innerHTML = placeholder;
             apCandidateList.innerHTML = placeholder;
             wardCandidateList.innerHTML = placeholder;
        }
    }

    function clearCandidateColumnsUI() {
        zpcCandidateList.innerHTML = '';
        apCandidateList.innerHTML = '';
        wardCandidateList.innerHTML = '';
    }

    /**
     * Exports the current data *visible* in the ballot table view to an Excel file.
     */
     function exportBallotTable() {
        if (!processedData.length) {
            alert("No data available to export."); return;
        }

        const dataToExport = [];
        // Define headers explicitly for correct order and naming
        const headers = [
            "No.", // Corresponds to visible row number
            "PS Name",
            "Total Voters",
            "ZPC Ballot", // Yes/No based on zpcNeeded
            "Total ZPC Ballots", // zpcTotal
            "AP Ballot", // Yes/No based on apNeeded
            "Total AP Ballots", // apTotal
            "Ward Ballot", // Yes/No based on wardNeeded
            "Total Ward Ballots", // wardTotal
            "Total Ballots" // psTotal
        ];

        const rows = ballotTableBody.getElementsByTagName('tr');
        let visibleRowCount = 0;
        let visibleTotalBallots = 0;

        for (const row of rows) {
             // Check if the row is NOT hidden by the filter
             if (!row.classList.contains('hidden')) {
                const rowIndex = parseInt(row.dataset.rowIndex, 10);
                 // Verify rowIndex is valid for the current processedData
                 if (!isNaN(rowIndex) && rowIndex >= 0 && rowIndex < processedData.length) {
                    visibleRowCount++;
                    const rowData = processedData[rowIndex];
                    visibleTotalBallots += rowData.ballotInfo.psTotal;

                    // Create an object matching the header order
                    dataToExport.push({
                        [headers[0]]: visibleRowCount, // Use the visible count
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
            alert("No data currently visible in the table to export (check filter?)."); return;
        }

        // Add summary row at the bottom
        dataToExport.push({}); // Add an empty row for spacing
        const summaryRow = {};
        summaryRow[headers[1]] = "Visible Rows Total Ballots:"; // Label in PS Name column
        summaryRow[headers[9]] = visibleTotalBallots;       // Value in Total Ballots column
        dataToExport.push(summaryRow);

        try {
            // Create worksheet using json_to_sheet with explicit header array
            const ws = XLSX.utils.json_to_sheet(dataToExport, { header: headers });

            // Optional: Adjust column widths (example)
            ws['!cols'] = [
                { wch: 5 },  // No.
                { wch: 40 }, // PS Name
                { wch: 15 }, // Total Voters
                { wch: 10 }, // ZPC Ballot
                { wch: 18 }, // Total ZPC Ballots
                { wch: 10 }, // AP Ballot
                { wch: 18 }, // Total AP Ballots
                { wch: 12 }, // Ward Ballot
                { wch: 18 }, // Total Ward Ballots
                { wch: 18 }  // Total Ballots
            ];


            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Ballot Count Export");
            XLSX.writeFile(wb, "Ballot_Count_Export.xlsx");
        } catch (error) {
            console.error("Error exporting to Excel:", error);
            alert(`An error occurred during export:\n${error.message}`);
        }
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
             document.title = 'Ballot Paper Requirements'; // Set title back
        }
         // Clear candidate columns when switching away from contestant view
         if (currentView === 'ballot_count') {
            clearCandidateColumnsUI();
             // Also deselect in PS list
            const previouslySelected = psList.querySelector('.selected');
            if (previouslySelected) previouslySelected.classList.remove('selected');
         }
    }

    /**
      * Sets the enabled/disabled state of UI controls based on loading status and data presence.
      * @param {boolean} loading - Is data currently being loaded?
      */
    function setControlsState(loading) {
        const hasData = processedData && processedData.length > 0;

        // Primary load actions are disabled *only* when loading
        loadFromUrlButton.disabled = loading;
        fileInput.disabled = loading; // Disable the input itself
        // Style the label to look disabled when the input is disabled
        if (fileInputLabel) {
            fileInputLabel.classList.toggle('button-disabled', loading);
        }


        // Data-dependent actions are disabled if loading OR if no data exists
        exportButton.disabled = loading || !hasData;
        ballotSearchInput.disabled = loading || !hasData;
        ballotSearchButton.disabled = loading || !hasData;
        psSearchInput.disabled = loading || !hasData;

        // View switching should always be possible if not loading
        switchViewButton.disabled = loading;

        // Clear search fields if they are being disabled and previously had data
        if (loading || !hasData) {
            ballotSearchInput.value = '';
            psSearchInput.value = '';
             // Also clear visual filters if controls are disabled
             filterBallotTable(); // Call filter functions to reset view
             filterPsList();
        }
    }

    // --- Initial Setup ---
    setControlsState(false); // Initial state: not loading, no data
    document.title = 'Ballot Paper Requirements'; // Initial title

}); // End DOMContentLoaded