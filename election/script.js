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
                rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
                if (!rawData.length) throw new Error(`Sheet '${sheetName}' is empty.`);
                const headers = Object.keys(rawData[0] || {});
                const psNameHeader = headers.find(h => h.trim().toLowerCase() === 'ps name');
                if (!psNameHeader) throw new Error("Required column 'PS Name' not found.");

                processRawData(rawData, psNameHeader);
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
        let url = googleSheetUrlInput.value.trim(); // Use let for Method 2 possibility
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
            // --- Cache Busting Implementation ---

            // METHOD 1 (Active): Use fetch options to prevent caching.
            // This tells the browser explicitly not to use or store a cached version.
            console.log("Fetching URL with cache: 'no-store'");
            const response = await fetch(url, { cache: 'no-store' });

            // METHOD 2 (Alternative - Commented Out): Append a unique query parameter.
            // This makes the browser think it's a different URL each time.
            // To use this method, comment out the 'fetch' line above and uncomment the lines below.
            /*
            console.log("Fetching URL with cache-busting query parameter.");
            const cacheBuster = '_=' + Date.now();
            const urlWithBuster = url + (url.includes('?') ? '&' : '?') + cacheBuster;
            const response = await fetch(urlWithBuster);
            */
            // --- End of Cache Busting Implementation ---


            if (!response.ok) {
                throw new Error(`Failed to fetch data. Status: ${response.status} ${response.statusText}. Ensure the link is correct and published publicly.`);
            }
            const csvText = await response.text();
            if (!csvText) {
                 throw new Error("Fetched data is empty. Check the Google Sheet or link.");
            }

            // Use SheetJS to parse the CSV string
            const workbook = XLSX.read(csvText, { type: 'string', raw: true });
            const sheetName = workbook.SheetNames[0];
            if (!sheetName) throw new Error("Could not parse CSV data.");
            rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
             if (!rawData.length) throw new Error("CSV data is empty after parsing.");

            const headers = Object.keys(rawData[0] || {});
            const psNameHeader = headers.find(h => h.trim().toLowerCase() === 'ps name');
            if (!psNameHeader) throw new Error("Required column 'PS Name' not found in the CSV data.");

            processRawData(rawData, psNameHeader);
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
         statusLabel.textContent = `Error: ${error.message}`;
         alert(`${contextMessage}:\n${error.message}`);
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
            const originalPsName = String(rawRow[psNameKey] || '').trim();
            if (!originalPsName) {
                // console.warn(`Skipping row ${index + 2} (source) due to empty PS Name.`);
                return;
            }
            if (seenPsNames.has(originalPsName)) {
                // console.warn(`Skipping duplicate PS Name: "${originalPsName}" at row ${index + 2} (source).`);
                return;
            }
            seenPsNames.add(originalPsName);

            const processedRow = {
                originalIndex: index,
                psName: originalPsName,
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
         clearCandidateColumnsUI();
         const previouslySelected = psList.querySelector('.selected');
         if (previouslySelected) {
             previouslySelected.classList.remove('selected');
         }
     }

    // --- UI Update Functions (updateBallotTableUI, filterBallotTable, Tooltip Handlers, populatePsListUI, filterPsList, handlePsSelect, updateCandidateColumnsUI, clearCandidateColumnsUI - unchanged from previous correct versions) ---
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
                tooltipElement.textContent = `ZPC Candidates: ${zpcText}\nAP Candidates:  ${apText}\nWard Candidates:${wardText}`;
                tooltipElement.style.display = 'block';
            } else { tooltipElement.style.display = 'none'; }
        } else { tooltipElement.style.display = 'none'; }
    }
    function handleTableMouseOut(event) {
         const relatedTarget = event.relatedTarget;
         if (!ballotTableBody.contains(relatedTarget) && relatedTarget !== tooltipElement) {
            tooltipElement.style.display = 'none';
         }
    }
    function handleTableMouseMove(event) {
        if (tooltipElement.style.display === 'block') {
            const xOffset = 15, yOffset = 10;
            tooltipElement.style.left = `${event.pageX + xOffset}px`;
            tooltipElement.style.top = `${event.pageY + yOffset}px`;
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
     */
     function exportBallotTable() {
        // (Keep the previously corrected export logic that handles visible rows)
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
        dataToExport.push({});
        dataToExport.push({ [headers[1]]: "Visible Rows Total", [headers[9]]: visibleTotalBallots });

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


    // --- UI State Management ---

    /**
     * Switches the visible UI view.
     */
    function switchView() {
        //exit function (bypass)
        return;
        
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

        // Clear search fields if they are being disabled and previously had data
        if (loading || !hasData) {
            ballotSearchInput.value = '';
            psSearchInput.value = '';
             // Also clear visual filters if controls are disabled
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


    // --- Initial Setup ---
    setControlsState(false); // Initial state: not loading, no data
    document.title = 'Ballot Paper Requirements';

}); // End DOMContentLoaded