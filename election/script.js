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

    // --- Constants ---
    const LOAD_URL_PARAM = 'loadUrl'; // Query parameter key

    // --- Utility Functions (Unchanged) ---
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
     function getCandidateNamesJSCaseInsensitive(row, lowerCasePrefix) {
        const candidates = [];
        if (!row || typeof lowerCasePrefix !== 'string') return candidates;
        for (const key in row) {
            if (Object.hasOwnProperty.call(row, key) && typeof key === 'string' && key.toLowerCase().startsWith(lowerCasePrefix)) {
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
     * Usually called on error or explicit reset, NOT as part of the reload flow.
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
         googleSheetUrlInput.value = ''; // Clear URL input too
         ballotSearchInput.value = '';
         psSearchInput.value = '';

         if (clearStatus) {
            statusLabel.textContent = 'No data loaded.';
         }

         setControlsState(isLoading); // Update controls based on current loading state
     }


    /**
     * Handles loading local Excel file (Remains unchanged, doesn't trigger reload)
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
                const psNameHeader = headers.find(h => typeof h === 'string' && h.trim().toLowerCase() === 'ps name');
                if (!psNameHeader) throw new Error("Required column 'PS Name' not found.");
                rawData = rawJson;
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
            endLoading();
        };
        reader.readAsArrayBuffer(file);
    }

    /**
     * Initiates the reload process when the URL load button is clicked.
     * This function DOES NOT perform the fetch itself anymore.
     */
    function initiateUrlLoadAndReload() {
        const url = googleSheetUrlInput.value.trim();
        if (!url) {
            alert("Please paste a Google Sheet 'Publish to web' CSV URL first.");
            return;
        }

        // --- Your Requested Actions ---
        console.log("Clearing local storage and initiating page reload...");
        try {
            localStorage.clear(); // Clear local storage
        } catch (e) {
            console.error("Could not clear local storage:", e);
            // Continue anyway, the reload is the main goal here
        }

        // Construct the URL to reload the page with the target sheet URL as a query parameter
        const reloadUrl = window.location.pathname + `?${LOAD_URL_PARAM}=` + encodeURIComponent(url);

        // Force a reload from the server (true parameter attempts to bypass cache)
        window.location.href = reloadUrl; // Navigate to the new URL which causes reload

        // Show loading indicator immediately (though page will reload shortly)
        statusLabel.textContent = "Reloading page to fetch fresh data...";
        setControlsState(true); // Disable controls while reload is initiated
    }

    /**
     * Performs the actual data fetching and processing from a URL.
     * This is called AFTER the page has reloaded if the specific query param is present.
     * @param {string} url - The Google Sheet URL to fetch.
     */
    async function fetchAndProcessUrlData(url) {
        if (!startLoading(`Loading from URL (after reload)...`)) return;

        try {
            // Use cache: 'no-store' AND cache-busting headers for maximum cache prevention
             const fetchOptions = {
                method: 'GET',
                cache: 'no-store',
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                }
            };
            // Optionally add a cache-busting query param *as well*
            let fetchUrl = url;
            const cacheBuster = '_=' + Date.now();
            fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + cacheBuster;

            const response = await fetch(fetchUrl, fetchOptions);

            if (!response.ok) {
                throw new Error(`Failed to fetch data. Status: ${response.status} ${response.statusText}. Check URL/permissions.`);
            }
            const csvText = await response.text();
            if (!csvText) {
                 throw new Error("Fetched data is empty. Check the Google Sheet or link.");
            }

            const workbook = XLSX.read(csvText, { type: 'string', raw: true });
            const sheetName = workbook.SheetNames[0];
            if (!sheetName) throw new Error("Could not parse CSV data.");
            const rawJson = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
            if (!rawJson.length) throw new Error("CSV data is empty after parsing.");
            const headers = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 })[0];
             if(!headers || headers.length === 0) throw new Error("Could not read headers from the CSV data.");
            const psNameHeader = headers.find(h => typeof h === 'string' && h.trim().toLowerCase() === 'ps name');
            if (!psNameHeader) throw new Error("Required column 'PS Name' not found in the CSV data.");
            rawData = rawJson;
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
         let userMessage = error.message || "An unknown error occurred.";
         // ... (rest of error message refinement logic - unchanged) ...
          if (error.message && error.message.includes("fetch")) {
             userMessage = `Network or fetch error: ${error.message}. Check the URL, your internet connection, and ensure the sheet is published correctly.`;
         } else if (error.message && error.message.includes("'PS Name' not found")) {
            userMessage = `Data structure error: ${error.message}. Verify the sheet has a column named 'PS Name'.`;
         } else if (error.message && (error.message.includes("sheet") || error.message.includes("parse"))) {
             userMessage = `File structure error: ${error.message}. Ensure the file/sheet is valid and not empty.`;
         }
         statusLabel.textContent = `Error: ${userMessage}`;
         alert(`${contextMessage}:\n${userMessage}`);
         resetApplicationState(false); // Reset state but keep load buttons enabled
    }


    /**
     * Cleans raw data, handles duplicates, calculates necessary values. (Unchanged)
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
            if (!originalPsName) return;
            const lowerCasePsName = originalPsName.toLowerCase();
            if (seenPsNames.has(lowerCasePsName)) {
                console.warn(`Skipping duplicate PS Name (case-insensitive): "${originalPsName}" at source row index ${index}.`);
                return;
            }
            seenPsNames.add(lowerCasePsName);

            const processedRow = {
                originalIndex: index,
                psName: originalPsName,
                voters: safeParseInt(findValueCaseInsensitive(rawRow, 'Total Number of Voter') || '0'),
                candidates: {},
                ballotInfo: {}
            };

            processedRow.candidates.zpc = getCandidateNamesJSCaseInsensitive(rawRow, 'zpm');
            processedRow.candidates.ap = getCandidateNamesJSCaseInsensitive(rawRow, 'apm');
            processedRow.candidates.ward = getCandidateNamesJSCaseInsensitive(rawRow, 'gpm');

            const zpcFlag = processedRow.candidates.zpc.length >= 2 ? 1 : 0;
            const apFlag = processedRow.candidates.ap.length >= 2 ? 1 : 0;
            const wardFlag = processedRow.candidates.ward.length >= 2 ? 1 : 0;

            processedRow.ballotInfo = {
                zpcNeeded: zpcFlag === 1, apNeeded: apFlag === 1, wardNeeded: wardFlag === 1,
                zpcTotal: zpcFlag * processedRow.voters, apTotal: apFlag * processedRow.voters,
                wardTotal: wardFlag * processedRow.voters,
                psTotal: (zpcFlag * processedRow.voters) + (apFlag * processedRow.voters) + (wardFlag * processedRow.voters)
            };
            processedData.push(processedRow);
        });

        processedData.sort((a, b) => a.psName.localeCompare(b.psName, undefined, { sensitivity: 'base' }));

        psNameToIndexMap = {}; psNames = [];
        processedData.forEach((row, newIndex) => {
             psNames.push(row.psName);
             psNameToIndexMap[row.psName] = newIndex;
        });
    }

    /**
     * Central function to trigger updates for both UI views. (Unchanged)
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

    // --- UI Update Functions (updateBallotTableUI, filterBallotTable, Tooltip Handlers, populatePsListUI, filterPsList, handlePsSelect, updateCandidateColumnsUI, clearCandidateColumnsUI - All Unchanged) ---
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
            const psNameCell = row.cells[1];
            if (psNameCell) {
                const psName = psNameCell.textContent.toLowerCase();
                const isVisible = psName.includes(searchTerm);
                row.classList.toggle('hidden', !isVisible);
                 if(isVisible) visibleCount++;
            } else {
                row.classList.add('hidden');
            }
        }
    }
    function handleTableMouseOver(event) {
        const cell = event.target.closest('td');
        const row = cell ? cell.closest('tr') : null;

        if (row && row.dataset.rowIndex !== undefined) {
            const rowIndex = parseInt(row.dataset.rowIndex, 10);
            if (!isNaN(rowIndex) && rowIndex >= 0 && rowIndex < processedData.length){
                const rowData = processedData[rowIndex];
                const zpcText = rowData.candidates.zpc && rowData.candidates.zpc.length > 0 ? rowData.candidates.zpc.join('\n - ') : 'Uncontested or Nil';
                const apText = rowData.candidates.ap && rowData.candidates.ap.length > 0 ? rowData.candidates.ap.join('\n - ') : 'Uncontested or Nil';
                const wardText = rowData.candidates.ward && rowData.candidates.ward.length > 0 ? rowData.candidates.ward.join('\n - ') : 'Uncontested or Nil';
                tooltipElement.innerHTML = `<strong>${rowData.psName}</strong><br>---<br>ZPC Candidates:<br> - ${zpcText}<br>---<br>AP Candidates:<br> - ${apText}<br>---<br>Ward Candidates:<br> - ${wardText}`;
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
            const viewportWidth = window.innerWidth, viewportHeight = window.innerHeight;
            const tooltipRect = tooltipElement.getBoundingClientRect();
            let top = event.pageY + yOffset, left = event.pageX + xOffset;
            if (top + tooltipRect.height > viewportHeight + window.scrollY) { top = event.pageY - tooltipRect.height - yOffset; }
            if (left + tooltipRect.width > viewportWidth + window.scrollX) { left = event.pageX - tooltipRect.width - xOffset; }
             if (top < window.scrollY) { top = window.scrollY + 5; }
             if (left < window.scrollX) { left = window.scrollX + 5; }
            tooltipElement.style.left = `${left}px`; tooltipElement.style.top = `${top}px`;
        }
    }
    function populatePsListUI() {
        psList.innerHTML = '';
        psSearchInput.value = '';
        if (!psNames.length) {
            psList.innerHTML = '<li>No polling stations loaded.</li>';
            return;
        }
        psNames.forEach((name) => {
            const li = document.createElement('li');
            li.textContent = name; li.dataset.psName = name;
            psList.appendChild(li);
        });
    }
    function filterPsList() {
        const searchTerm = psSearchInput.value.trim().toLowerCase();
        const items = psList.getElementsByTagName('li');
        let hasVisibleItems = false;
        for (const item of items) {
            if (item.dataset.psName) {
                const psName = item.dataset.psName.toLowerCase();
                const isVisible = psName.includes(searchTerm);
                item.classList.toggle('hidden', !isVisible);
                if (isVisible) hasVisibleItems = true;
            } else { item.classList.add('hidden'); }
        }
    }
    function handlePsSelect(event) {
        if (event.target.tagName === 'LI' && event.target.dataset.psName) {
            const selectedLi = event.target; const psName = selectedLi.dataset.psName;
            const previouslySelected = psList.querySelector('.selected');
            if (previouslySelected) previouslySelected.classList.remove('selected');
            selectedLi.classList.add('selected');
            if (psName && psNameToIndexMap.hasOwnProperty(psName)) {
                const index = psNameToIndexMap[psName];
                if(index >= 0 && index < processedData.length){ updateCandidateColumnsUI(processedData[index].candidates); }
                else { console.error(`Index ${index} out of bounds.`); clearCandidateColumnsUI(); }
            } else { console.error(`PS Name "${psName}" not found.`); clearCandidateColumnsUI(); }
        }
    }
    function updateCandidateColumnsUI(candidates) {
        clearCandidateColumnsUI();
        const populateList = (listElement, candidateArray) => {
            if (candidateArray && candidateArray.length > 0) {
                candidateArray.forEach(name => { listElement.insertAdjacentHTML('beforeend', `<li>${name}</li>`); });
            } else { listElement.insertAdjacentHTML('beforeend', `<li class="uncontested">Uncontested or Nil</li>`); }
        };
        if (candidates) {
            populateList(zpcCandidateList, candidates.zpc);
            populateList(apCandidateList, candidates.ap);
            populateList(wardCandidateList, candidates.ward);
        } else {
             const placeholder = `<li class="uncontested">Data unavailable</li>`;
             zpcCandidateList.innerHTML = placeholder; apCandidateList.innerHTML = placeholder; wardCandidateList.innerHTML = placeholder;
        }
    }
    function clearCandidateColumnsUI() {
        zpcCandidateList.innerHTML = ''; apCandidateList.innerHTML = ''; wardCandidateList.innerHTML = '';
    }
    function exportBallotTable() {
        if (!processedData.length) { alert("No data available to export."); return; }
        const dataToExport = [];
        const headers = ["No.", "PS Name", "Total Voters", "ZPC Ballot", "Total ZPC Ballots", "AP Ballot", "Total AP Ballots", "Ward Ballot", "Total Ward Ballots", "Total Ballots"];
        const rows = ballotTableBody.getElementsByTagName('tr');
        let visibleRowCount = 0; let visibleTotalBallots = 0;
        for (const row of rows) {
             if (!row.classList.contains('hidden')) {
                const rowIndex = parseInt(row.dataset.rowIndex, 10);
                 if (!isNaN(rowIndex) && rowIndex >= 0 && rowIndex < processedData.length) {
                    visibleRowCount++;
                    const rowData = processedData[rowIndex];
                    visibleTotalBallots += rowData.ballotInfo.psTotal;
                    dataToExport.push({
                        [headers[0]]: visibleRowCount, [headers[1]]: rowData.psName, [headers[2]]: rowData.voters,
                        [headers[3]]: rowData.ballotInfo.zpcNeeded ? 'Yes' : 'No', [headers[4]]: rowData.ballotInfo.zpcTotal,
                        [headers[5]]: rowData.ballotInfo.apNeeded ? 'Yes' : 'No', [headers[6]]: rowData.ballotInfo.apTotal,
                        [headers[7]]: rowData.ballotInfo.wardNeeded ? 'Yes' : 'No', [headers[8]]: rowData.ballotInfo.wardTotal,
                        [headers[9]]: rowData.ballotInfo.psTotal
                    });
                 } else { console.warn(`Skipping row export: invalid index ${row.dataset.rowIndex}`); }
             }
        }
        if (!dataToExport.length) { alert("No data currently visible to export."); return; }
        dataToExport.push({});
        const summaryRow = {};
        summaryRow[headers[1]] = "Visible Rows Total Ballots:"; summaryRow[headers[9]] = visibleTotalBallots;
        dataToExport.push(summaryRow);
        try {
            const ws = XLSX.utils.json_to_sheet(dataToExport, { header: headers });
            ws['!cols'] = [ {wch:5},{wch:40},{wch:15},{wch:10},{wch:18},{wch:10},{wch:18},{wch:12},{wch:18},{wch:18} ];
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Ballot Count Export");
            XLSX.writeFile(wb, "Ballot_Count_Export.xlsx");
        } catch (error) { console.error("Error exporting:", error); alert(`Export error:\n${error.message}`); }
    }

    // --- UI State Management (switchView, setControlsState - Unchanged) ---
    function switchView() {
        if (currentView === 'ballot_count') {
            ballotCountView.classList.remove('active-view'); contestantNamesView.classList.add('active-view');
            currentView = 'contestant_names'; switchViewButton.textContent = 'Switch to Ballot Count View';
            document.title = 'Polling Station Candidate Viewer';
        } else {
            contestantNamesView.classList.remove('active-view'); ballotCountView.classList.add('active-view');
            currentView = 'ballot_count'; switchViewButton.textContent = 'Switch to Contestant View';
             document.title = 'Ballot Paper Requirements';
        }
         if (currentView === 'ballot_count') {
            clearCandidateColumnsUI();
            const previouslySelected = psList.querySelector('.selected');
            if (previouslySelected) previouslySelected.classList.remove('selected');
         }
    }
    function setControlsState(loading) {
        const hasData = processedData && processedData.length > 0;
        loadFromUrlButton.disabled = loading;
        fileInput.disabled = loading;
        if (fileInputLabel) { fileInputLabel.classList.toggle('button-disabled', loading); }
        exportButton.disabled = loading || !hasData;
        ballotSearchInput.disabled = loading || !hasData;
        ballotSearchButton.disabled = loading || !hasData;
        psSearchInput.disabled = loading || !hasData;
        switchViewButton.disabled = loading; // Allow switching only when not loading
        if (loading || !hasData) {
            ballotSearchInput.value = ''; psSearchInput.value = '';
             filterBallotTable(); filterPsList();
        }
    }


    // --- Event Listeners ---
    fileInput.addEventListener('change', handleFileLoad);
    // MODIFIED: Button now calls the reload initiator function
    loadFromUrlButton.addEventListener('click', initiateUrlLoadAndReload);
    switchViewButton.addEventListener('click', switchView);
    exportButton.addEventListener('click', exportBallotTable);
    ballotSearchButton.addEventListener('click', filterBallotTable);
    ballotSearchInput.addEventListener('input', filterBallotTable);
    psSearchInput.addEventListener('input', filterPsList);
    psList.addEventListener('click', handlePsSelect);
    ballotTableBody.addEventListener('mouseover', handleTableMouseOver);
    ballotTableBody.addEventListener('mouseout', handleTableMouseOut);
    ballotTableBody.addEventListener('mousemove', handleTableMouseMove);


    // --- Initial Setup ---
    setControlsState(false); // Initial state: not loading, no data
    document.title = 'Ballot Paper Requirements'; // Initial title

    // --- Check for Auto-Load URL on Page Load ---
    const urlParams = new URLSearchParams(window.location.search);
    const urlToLoad = urlParams.get(LOAD_URL_PARAM);

    if (urlToLoad) {
        console.log("URL parameter found, attempting auto-load:", urlToLoad);
        googleSheetUrlInput.value = urlToLoad; // Pre-fill the input

        // Call the actual fetch function
        fetchAndProcessUrlData(urlToLoad); // Pass the decoded URL

        // Clean the URL in history so a simple refresh doesn't re-trigger the load
        // Use try-catch as history API might not be available/allowed in all contexts (e.g., file://)
        try {
             history.replaceState(null, '', window.location.pathname);
        } catch(e) {
            console.warn("Could not clean URL parameter from history:", e);
        }

    } else {
        // Standard initial state if no auto-load parameter is found
        statusLabel.textContent = 'No data loaded.';
    }

}); // End DOMContentLoaded