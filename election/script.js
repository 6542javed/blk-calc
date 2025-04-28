document.addEventListener('DOMContentLoaded', async () => { // Make the listener async
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
    const fileInputLabel = document.querySelector('label[for="excelFile"]');
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

    // --- Utility Functions (getCandidateNamesJS, safeParseInt - unchanged) ---
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

    // --- Event Listeners ---
    fileInput.addEventListener('change', handleFileLoad);
    loadFromUrlButton.addEventListener('click', handleUrlLoad);
    switchViewButton.addEventListener('click', switchView);
    exportButton.addEventListener('click', exportBallotTable);
    ballotSearchButton.addEventListener('click', filterBallotTable);
    ballotSearchInput.addEventListener('input', filterBallotTable);
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
        fileInput.value = ''; // Reset file input value
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
     * Handles loading local Excel file (selected via input).
     * NOTE: This function remains unchanged as it primarily targets Excel files.
     * SheetJS might auto-detect TSV/CSV dropped here, but the main change is for URL/default load.
     */
    function handleFileLoad(event) {
        const file = event.target.files[0];
        if (!file) return;
        if (!startLoading(`Loading file: ${file.name}...`)) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                // SheetJS attempts to auto-detect format when reading from buffer
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                if (!sheetName) throw new Error("File has no sheets or could not be parsed.");
                rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
                if (!rawData.length) throw new Error(`Sheet '${sheetName}' is empty.`);
                const headers = Object.keys(rawData[0] || {});
                const psNameHeader = headers.find(h => h.trim().toLowerCase() === 'ps name');
                if (!psNameHeader) throw new Error("Required column 'PS Name' not found.");

                processRawData(rawData, psNameHeader);
                updateAllUIs();
                statusLabel.textContent = `Loaded ${processedData.length} unique PS from: ${file.name}`;
            } catch (error) {
                handleLoadingError(error, `Error processing file "${file.name}"`);
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
     * Handles loading data from Google Sheet URL (expecting TSV format).
     */
    async function handleUrlLoad() {
        let url = googleSheetUrlInput.value.trim();
        if (!url) {
            alert("Please paste a Google Sheet 'Publish to web' TSV URL first."); // Changed alert message
            return;
        }

        // Updated check and warning message for TSV
        if (!url.includes('/pub?') || !url.includes('output=tsv')) {
             console.warn("URL format might be incorrect. Expected a Google Sheet 'Publish to web' TSV link (containing '/pub?' and 'output=tsv'). Attempting to load anyway...");
        }

        if (!startLoading(`Loading from URL...`)) return;

        try {
            console.log("Fetching URL with cache: 'no-store'");
            const response = await fetch(url, { cache: 'no-store' });

            if (!response.ok) {
                throw new Error(`Failed to fetch data. Status: ${response.status} ${response.statusText}. Ensure the link is correct and published publicly as TSV.`);
            }
            const tsvText = await response.text(); // Changed variable name
            if (!tsvText) {
                 throw new Error("Fetched data is empty. Check the Google Sheet or link.");
            }

            // Use SheetJS to parse the TSV string. It often auto-detects delimiters correctly when reading from a string.
            const workbook = XLSX.read(tsvText, { type: 'string', raw: true }); // Changed variable name
            const sheetName = workbook.SheetNames[0];
            if (!sheetName) throw new Error("Could not parse TSV data."); // Changed error message
            rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
             if (!rawData.length) throw new Error("TSV data is empty after parsing."); // Changed error message

            const headers = Object.keys(rawData[0] || {});
            const psNameHeader = headers.find(h => h.trim().toLowerCase() === 'ps name');
            if (!psNameHeader) throw new Error("Required column 'PS Name' not found in the TSV data."); // Changed error message

            processRawData(rawData, psNameHeader);
            updateAllUIs();
            statusLabel.textContent = `Loaded ${processedData.length} unique PS from URL (TSV).`; // Updated status

        } catch (error) {
             handleLoadingError(error, "Error loading from URL (TSV)"); // Updated context
        } finally {
            endLoading();
        }
    }

    /**
     * Handles loading the default local TSV file.
     */
    async function loadDefaultTsv() { // Renamed function
        const defaultFilename = '27 april data.tsv'; // Changed default filename
        if (!startLoading(`Loading default data (${defaultFilename})...`)) return;

        try {
            // Fetch the local file (relative path)
            console.log(`Fetching default file: ${defaultFilename}`);
            const response = await fetch(defaultFilename, { cache: 'no-store' }); // Add cache control here too

            if (!response.ok) {
                // File not found or other server error
                if (response.status === 404) {
                    throw new Error(`Default file '${defaultFilename}' not found in the same directory as the HTML file.`);
                } else {
                    throw new Error(`Failed to fetch default file. Status: ${response.status} ${response.statusText}`);
                }
            }
            const tsvText = await response.text(); // Changed variable name
            if (!tsvText) {
                 throw new Error(`Default file '${defaultFilename}' is empty.`);
            }

            // Use SheetJS to parse the TSV string
            const workbook = XLSX.read(tsvText, { type: 'string', raw: true }); // Changed variable name
            const sheetName = workbook.SheetNames[0];
            if (!sheetName) throw new Error("Could not parse TSV data from default file."); // Changed error message
            rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
             if (!rawData.length) throw new Error("Default TSV data is empty after parsing."); // Changed error message

            const headers = Object.keys(rawData[0] || {});
            const psNameHeader = headers.find(h => h.trim().toLowerCase() === 'ps name');
            if (!psNameHeader) throw new Error("Required column 'PS Name' not found in the default TSV data."); // Changed error message

            processRawData(rawData, psNameHeader);
            updateAllUIs();
            statusLabel.textContent = `Loaded ${processedData.length} unique PS from default file: ${defaultFilename}.`;
            console.log(`Successfully loaded default data from ${defaultFilename}.`);

        } catch (error) {
             // Use handleLoadingError, but provide a more specific context
             handleLoadingError(error, `Error loading default file (${defaultFilename})`);
             // Optionally, provide more user-friendly feedback if the default load fails
             // statusLabel.textContent = `Could not load default data. Please load manually. Error: ${error.message}`;
             console.warn("Default data load failed. User can load manually.");
        } finally {
            endLoading(); // Always end loading state, regardless of success/failure
        }
    }


    /**
     * Centralized error handling for loading processes.
     */
    function handleLoadingError(error, contextMessage = "Error") {
         console.error(`${contextMessage}:`, error);
         // Keep the status message more informative than just "No data loaded"
         statusLabel.textContent = `${contextMessage}: ${error.message}. Please try loading manually.`;
         // alert(`${contextMessage}:\n${error.message}`); // Alert might be too intrusive for default load failure
         resetApplicationState(false); // Reset state but keep load buttons enabled and don't clear the error status
    }


     /**
     * Cleans raw data, handles duplicates, calculates necessary values.
     * @param {object[]} sourceData - Data array from SheetJS (JSON).
     * @param {string} psNameKey - The exact key found for 'PS Name'.
     */
    function processRawData(sourceData, psNameKey) {
        // Reset state specific to processing
        processedData = [];
        psNameToIndexMap = {};
        psNames = [];
        totalAllBallots = 0; // Reset total when new data is processed
        const seenPsNames = new Set();

        sourceData.forEach((rawRow, index) => {
            const originalPsName = String(rawRow[psNameKey] || '').trim();
            if (!originalPsName) {
                // console.warn(`Skipping row ${index + 2} (source) due to empty PS Name.`);
                return;
            }
            // Handle potential duplicates case-insensitively for robustness
            const lowerCasePsName = originalPsName.toLowerCase();
            if (seenPsNames.has(lowerCasePsName)) {
                 console.warn(`Skipping duplicate PS Name (case-insensitive): "${originalPsName}" at row ${index + 2} (source).`);
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

            processedRow.candidates.zpc = getCandidateNamesJS(rawRow, 'ZPM');
            processedRow.candidates.ap = getCandidateNamesJS(rawRow, 'APM');
            processedRow.candidates.ward = getCandidateNamesJS(rawRow, 'GPM');

            // Ensure ballot calculation columns exist, using case-insensitive lookup
            const zpcFlag = processedRow.candidates.zpc.length >= 2 ? 1 : 0;
            const apFlag = processedRow.candidates.ap.length >= 2 ? 1 : 0;
            const wardFlag = processedRow.candidates.ward.length >= 2 ? 1 : 0;

            // Calculate ballot info based on flags and voters
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
            totalAllBallots += processedRow.ballotInfo.psTotal; // Accumulate total here
        });

        // Sort after processing all rows
        processedData.sort((a, b) => a.psName.localeCompare(b.psName));

        // Build the index map after sorting
        processedData.forEach((row, newIndex) => {
             psNames.push(row.psName);
             psNameToIndexMap[row.psName] = newIndex;
        });

        console.log(`Processed ${processedData.length} unique PS entries. Total ballots: ${totalAllBallots}`);
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

    /**
     * Central function to trigger updates for both UI views.
     */
     function updateAllUIs() {
         updateBallotTableUI();
         populatePsListUI();
         clearCandidateColumnsUI(); // Clear candidate display initially
         const previouslySelected = psList.querySelector('.selected');
         if (previouslySelected) {
             previouslySelected.classList.remove('selected');
         }
         // Filter inputs should be cleared by setControlsState if needed
     }

    // --- UI Update Functions (updateBallotTableUI, filterBallotTable, Tooltip Handlers, populatePsListUI, filterPsList, handlePsSelect, updateCandidateColumnsUI, clearCandidateColumnsUI - unchanged) ---
    // --- These functions remain unchanged as they operate on the processedData, independent of the source format ---
    function updateBallotTableUI() {
        ballotTableBody.innerHTML = '';
        if (!processedData.length) {
            ballotSummaryLabel.textContent = 'No data loaded or processed.';
            return;
        }
        processedData.forEach((row, index) => {
            const tr = document.createElement('tr');
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
    function filterBallotTable() {
        const searchTerm = ballotSearchInput.value.trim().toLowerCase();
        const rows = ballotTableBody.getElementsByTagName('tr');
        for (const row of rows) {
            const psNameCell = row.cells[1];
            if (psNameCell) {
                const psName = psNameCell.textContent.toLowerCase();
                row.classList.toggle('hidden', !psName.includes(searchTerm));
            }
        }
    }
    function handleTableMouseOver(event) {
        const row = event.target.closest('tr');
        if (row && row.dataset.rowIndex !== undefined) {
            const rowIndex = parseInt(row.dataset.rowIndex, 10);
            if (rowIndex >= 0 && rowIndex < processedData.length){
                const rowData = processedData[rowIndex];
                const zpcText = rowData.candidates.zpc.length > 0 ? rowData.candidates.zpc.join(', ') : 'Uncontested or Nil';
                const apText = rowData.candidates.ap.length > 0 ? rowData.candidates.ap.join(', ') : 'Uncontested or Nil';
                const wardText = rowData.candidates.ward.length > 0 ? rowData.candidates.ward.join(', ') : 'Uncontested or Nil';
                tooltipElement.innerHTML = `ZPC Candidates: ${zpcText}<br>AP Candidates:  ${apText}<br>Ward Candidates: ${wardText}`;
                tooltipElement.style.display = 'block';
            } else { tooltipElement.style.display = 'none'; }
        } else { tooltipElement.style.display = 'none'; }
    }
    function handleTableMouseOut(event) {
         const relatedTarget = event.relatedTarget;
         if (!ballotTableBody.contains(relatedTarget) && !tooltipElement.contains(relatedTarget)) {
            tooltipElement.style.display = 'none';
         }
    }
    function handleTableMouseMove(event) {
        if (tooltipElement.style.display === 'block') {
            const xOffset = 15, yOffset = 10;
             const viewportWidth = window.innerWidth;
             const viewportHeight = window.innerHeight;
             const tooltipRect = tooltipElement.getBoundingClientRect();
             let left = event.pageX + xOffset;
             let top = event.pageY + yOffset;
             if (left + tooltipRect.width > viewportWidth) { left = event.pageX - tooltipRect.width - xOffset; }
             if (top + tooltipRect.height > viewportHeight) { top = event.pageY - tooltipRect.height - yOffset; }
             if (left < 0) left = 0;
             if (top < 0) top = 0;
            tooltipElement.style.left = `${left}px`;
            tooltipElement.style.top = `${top}px`;
        }
    }
    function populatePsListUI() {
        psList.innerHTML = '';
        psSearchInput.value = '';
        if (!psNames.length) return;
        psNames.forEach((name) => {
            const li = document.createElement('li');
            li.textContent = name;
            li.dataset.psName = name;
            psList.appendChild(li);
        });
    }
    function filterPsList() {
        const searchTerm = psSearchInput.value.trim().toLowerCase();
        const items = psList.getElementsByTagName('li');
        for (const item of items) {
            const psName = item.textContent.toLowerCase();
            item.classList.toggle('hidden', !psName.includes(searchTerm));
        }
    }
    function handlePsSelect(event) {
        if (event.target.tagName === 'LI') {
            const selectedLi = event.target;
            const psName = selectedLi.dataset.psName;
            const previouslySelected = psList.querySelector('.selected');
            if (previouslySelected) previouslySelected.classList.remove('selected');
            selectedLi.classList.add('selected');
            if (psName && psNameToIndexMap.hasOwnProperty(psName)) {
                const index = psNameToIndexMap[psName];
                if(index >= 0 && index < processedData.length){
                    updateCandidateColumnsUI(processedData[index].candidates);
                } else { clearCandidateColumnsUI(); }
            } else { clearCandidateColumnsUI(); }
        }
    }
    function updateCandidateColumnsUI(candidates) {
        clearCandidateColumnsUI();
        const populateList = (listElement, candidateArray) => {
            if (candidateArray && candidateArray.length > 0) {
                candidateArray.forEach(name => { listElement.insertAdjacentHTML('beforeend', `<li>${name}</li>`); });
            } else {
                listElement.insertAdjacentHTML('beforeend', `<li class="uncontested">Uncontested or Nil</li>`);
            }
        };
        populateList(zpcCandidateList, candidates.zpc);
        populateList(apCandidateList, candidates.ap);
        populateList(wardCandidateList, candidates.ward);
    }
    function clearCandidateColumnsUI() {
        zpcCandidateList.innerHTML = '';
        apCandidateList.innerHTML = '';
        wardCandidateList.innerHTML = '';
    }

    /**
     * Exports the current data *visible* in the ballot table view to an Excel file.
     * Unchanged - export format remains Excel.
     */
     function exportBallotTable() {
        if (!processedData.length) {
            alert("No data available to export."); return;
        }
        const dataToExport = [];
        const headers = ["No.", "PS Name", "Total Voters", "ZPC Ballot", "Total ZPC Ballots", "AP Ballot", "Total AP Ballots", "Ward Ballot", "Total Ward Ballots", "Total Ballots"];
        const rows = ballotTableBody.getElementsByTagName('tr');
        let visibleRowCount = 0;
        let visibleTotalBallots = 0;

        for (const row of rows) {
             if (!row.classList.contains('hidden')) {
                visibleRowCount++;
                const rowIndex = parseInt(row.dataset.rowIndex, 10);
                 if (rowIndex >= 0 && rowIndex < processedData.length) {
                    const rowData = processedData[rowIndex];
                    visibleTotalBallots += rowData.ballotInfo.psTotal;
                    dataToExport.push({
                        [headers[0]]: visibleRowCount, [headers[1]]: rowData.psName, [headers[2]]: rowData.voters,
                        [headers[3]]: rowData.ballotInfo.zpcNeeded ? 'Yes' : 'No', [headers[4]]: rowData.ballotInfo.zpcTotal,
                        [headers[5]]: rowData.ballotInfo.apNeeded ? 'Yes' : 'No', [headers[6]]: rowData.ballotInfo.apTotal,
                        [headers[7]]: rowData.ballotInfo.wardNeeded ? 'Yes' : 'No', [headers[8]]: rowData.ballotInfo.wardTotal,
                        [headers[9]]: rowData.ballotInfo.psTotal
                    });
                 }
             }
        }
        if (!dataToExport.length) {
            alert("No data currently visible in the table to export (check filter?)."); return;
        }
        dataToExport.push({}); // Add an empty row for spacing
        dataToExport.push({ [headers[1]]: "Visible Rows Total", [headers[9]]: visibleTotalBallots }); // Add summary row

        try {
            const ws = XLSX.utils.json_to_sheet(dataToExport, { header: headers });
            ws['!cols'] = [ {wch:5}, {wch:30}, {wch:15}, {wch:10}, {wch:18}, {wch:10}, {wch:18}, {wch:10}, {wch:18}, {wch:18} ]; // Adjust widths as needed
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Ballot Count Export");
            XLSX.writeFile(wb, "Ballot_Count_Export.xlsx");
        } catch (error) {
            console.error("Error exporting to Excel:", error);
            alert(`An error occurred during export:\n${error.message}`);
        }
    }


    // --- UI State Management --- Unchanged

    /**
     * Switches the visible UI view.
     */
    function switchView() {
        //exit function (bypass)
        return;

        // Keep the rest of the function as it was, in case you want to re-enable it later
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
      * Sets the enabled/disabled state of UI controls based on loading status and data presence.
      * @param {boolean} loading - Is data currently being loaded?
      */
    function setControlsState(loading) {
        const hasData = !loading && processedData && processedData.length > 0;
        loadFromUrlButton.disabled = loading;
        fileInput.disabled = loading;
        if (fileInputLabel) { fileInputLabel.classList.toggle('button-disabled', loading); }
        exportButton.disabled = loading || !hasData;
        ballotSearchInput.disabled = loading || !hasData;
        ballotSearchButton.disabled = loading || !hasData;
        psSearchInput.disabled = loading || !hasData;
        switchViewButton.disabled = loading || !hasData;
        if (loading || !hasData) {
            ballotSearchInput.value = '';
            psSearchInput.value = '';
            filterBallotTable();
            filterPsList();
        }
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
         resetUIOnly();
         ballotSummaryLabel.textContent = 'Load data to see totals.';
         googleSheetUrlInput.value = '';
         ballotSearchInput.value = '';
         psSearchInput.value = '';
         if (clearStatus) { statusLabel.textContent = 'No data loaded.'; }
         setControlsState(isLoading);
     }


    // --- Initial Setup ---
    // 1. Set initial UI state (controls disabled, title set)
    document.title = 'Ballot Paper Requirements';
    setControlsState(true); // Start with controls disabled as we attempt default load
    statusLabel.textContent = 'Initializing...'; // Initial status

    // 2. Attempt to load default TSV data
    await loadDefaultTsv(); // Changed function call

    // 3. Final state is set by endLoading() within loadDefaultTsv (or its error handler)
    console.log("Initialization complete. Default data load attempted.");

}); // End DOMContentLoaded