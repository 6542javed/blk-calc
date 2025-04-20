document.addEventListener('DOMContentLoaded', () => {
    // --- Global State ---
    let rawData = [];
    let originalRawDataString = ''; // Store stringified raw data for comparison
    let processedData = [];
    let psNames = [];
    let psNameToIndexMap = {};
    let currentView = 'ballot_count';
    let totalAllBallots = 0;
    let isLoading = false; // Flag to prevent concurrent loading
    let googleSheetUrlUsed = null; // Store the URL used for loading
    let autoRefreshIntervalId = null; // ID for setInterval
    let isCheckingForUpdates = false; // Flag to prevent overlapping checks
    const REFRESH_CHECK_INTERVAL = 10000; // Check every 10 seconds

    // --- DOM Element References ---
    const fileInput = document.getElementById('excelFile');
    const fileInputLabel = document.querySelector('label[for="excelFile"]');
    const googleSheetUrlInput = document.getElementById('googleSheetUrl');
    const loadFromUrlButton = document.getElementById('loadFromUrlButton');
    const statusLabel = document.getElementById('statusLabel');
    const updateNotificationArea = document.getElementById('updateNotificationArea'); // Get notification element
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

    function startLoading(message = 'Loading data...') {
        if (isLoading) {
            console.warn("Already loading data.");
            return false;
        }
        isLoading = true;
        statusLabel.textContent = message;
        updateNotificationArea.textContent = ''; // Clear notifications on new load
        stopAutoRefreshCheck(); // Stop checking during load
        setControlsState(true);
        resetUIOnly();
        return true;
    }

    function endLoading() {
        isLoading = false;
        setControlsState(false);
        fileInput.value = '';
        // Restart check ONLY if data was loaded from a URL
        if (googleSheetUrlUsed) {
            startAutoRefreshCheck(googleSheetUrlUsed);
        }
    }

    function resetUIOnly() {
        ballotTableBody.innerHTML = '';
        psList.innerHTML = '';
        clearCandidateColumnsUI();
        ballotSummaryLabel.textContent = 'Processing...';
        tooltipElement.style.display = 'none';
        updateNotificationArea.textContent = ''; // Clear notification
    }

    function handleFileLoad(event) {
        const file = event.target.files[0];
        if (!file) return;
        if (!startLoading(`Loading file: ${file.name}...`)) return;

        // Stop any previous URL checking
        stopAutoRefreshCheck();
        googleSheetUrlUsed = null; // Ensure URL is cleared

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                if (!sheetName) throw new Error("Excel file has no sheets.");
                rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
                if (!rawData.length) throw new Error(`Sheet '${sheetName}' is empty.`);
                originalRawDataString = JSON.stringify(rawData); // Store for comparison (though not used for file)
                const headers = Object.keys(rawData[0] || {});
                const psNameHeader = headers.find(h => h.trim().toLowerCase() === 'ps name');
                if (!psNameHeader) throw new Error("Required column 'PS Name' not found.");

                processRawData(rawData, psNameHeader);
                updateAllUIs();
                statusLabel.textContent = `Loaded ${processedData.length} unique PS from: ${file.name}`;
            } catch (error) {
                handleLoadingError(error, "Error processing Excel file");
            } finally {
                endLoading(); // Will not restart timer as googleSheetUrlUsed is null
            }
        };
        reader.onerror = (e) => {
            console.error("FileReader error:", e);
            handleLoadingError(new Error("An error occurred while trying to read the file."), "File Read Error");
            endLoading(); // Will not restart timer
        };
        reader.readAsArrayBuffer(file);
    }

    async function handleUrlLoad() {
        const url = googleSheetUrlInput.value.trim();
        if (!url) {
            alert("Please paste a Google Sheet 'Publish to web' CSV URL first.");
            return;
        }
        if (!url.includes('/pub?') || !url.includes('output=csv')) {
             console.warn("URL format might be incorrect. Expected a Google Sheet 'Publish to web' CSV link (containing '/pub?' and 'output=csv'). Attempting to load anyway...");
        }

        if (!startLoading(`Loading from URL...`)) return;

        // Stop previous check if any (startLoading already does this, but being explicit)
        stopAutoRefreshCheck();

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to fetch data. Status: ${response.status} ${response.statusText}. Ensure the link is correct and published publicly.`);
            }
            const csvText = await response.text();
            if (!csvText) {
                 throw new Error("Fetched data is empty. Check the Google Sheet or link.");
            }

            const workbook = XLSX.read(csvText, { type: 'string', raw: true });
            const sheetName = workbook.SheetNames[0];
            if (!sheetName) throw new Error("Could not parse CSV data.");
            rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
             if (!rawData.length) throw new Error("CSV data is empty after parsing.");
            originalRawDataString = JSON.stringify(rawData); // Store stringified version

            const headers = Object.keys(rawData[0] || {});
            const psNameHeader = headers.find(h => h.trim().toLowerCase() === 'ps name');
            if (!psNameHeader) throw new Error("Required column 'PS Name' not found in the CSV data.");

            processRawData(rawData, psNameHeader);
            updateAllUIs();
            statusLabel.textContent = `Loaded ${processedData.length} unique PS from URL.`;
            googleSheetUrlUsed = url; // Store the successfully loaded URL

        } catch (error) {
             handleLoadingError(error, "Error loading from URL");
             googleSheetUrlUsed = null; // Clear URL on error
        } finally {
            endLoading(); // Will start timer ONLY if googleSheetUrlUsed was set successfully
        }
    }

    function handleLoadingError(error, contextMessage = "Error") {
         console.error(`${contextMessage}:`, error);
         statusLabel.textContent = `Error: ${error.message}`;
         updateNotificationArea.textContent = ''; // Clear notification area on error
         alert(`${contextMessage}:\n${error.message}`);
         stopAutoRefreshCheck(); // Stop checking on error
         googleSheetUrlUsed = null; // Ensure URL is cleared
         resetApplicationState(false); // Reset state but keep load buttons enabled
         // Ensure loading state is truly finished
         isLoading = false;
         setControlsState(false);
         fileInput.value = '';
    }

    function processRawData(sourceData, psNameKey) {
        // ... (processRawData remains exactly the same)
        processedData = [];
        psNameToIndexMap = {};
        psNames = [];
        const seenPsNames = new Set();

        sourceData.forEach((rawRow, index) => {
            const originalPsName = String(rawRow[psNameKey] || '').trim();
            if (!originalPsName) {
                return;
            }
            if (seenPsNames.has(originalPsName)) {
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

    function findValueCaseInsensitive(obj, targetKey) {
        // ... (findValueCaseInsensitive remains exactly the same)
        if (!obj || typeof targetKey !== 'string') return undefined;
        const lowerTargetKey = targetKey.toLowerCase();
        for (const key in obj) {
            if (Object.hasOwnProperty.call(obj, key) && String(key).toLowerCase() === lowerTargetKey) {
                return obj[key];
            }
        }
        return undefined;
    }

    function updateAllUIs() {
         updateBallotTableUI();
         populatePsListUI();
         clearCandidateColumnsUI();
         const previouslySelected = psList.querySelector('.selected');
         if (previouslySelected) {
             previouslySelected.classList.remove('selected');
         }
     }

    // --- UI Update Functions (updateBallotTableUI, filterBallotTable, Tooltip Handlers, populatePsListUI, filterPsList, handlePsSelect, updateCandidateColumnsUI, clearCandidateColumnsUI - unchanged) ---
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

    function exportBallotTable() {
        // ... (exportBallotTable remains exactly the same)
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

    function switchView() {
        // ... (switchView remains exactly the same)
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

    function setControlsState(loading) {
        // ... (setControlsState remains exactly the same)
        const hasData = processedData && processedData.length > 0;

        loadFromUrlButton.disabled = loading;
        fileInput.disabled = loading;
        if (fileInputLabel) {
            fileInputLabel.classList.toggle('button-disabled', loading);
        }

        exportButton.disabled = loading || !hasData;
        ballotSearchInput.disabled = loading || !hasData;
        ballotSearchButton.disabled = loading || !hasData;
        psSearchInput.disabled = loading || !hasData;

        if (loading || !hasData) {
            ballotSearchInput.value = '';
            psSearchInput.value = '';
             filterBallotTable();
             filterPsList();
        }
    }

    function resetApplicationState(clearStatus = true) {
         rawData = [];
         originalRawDataString = ''; // Reset stored data string
         processedData = [];
         psNames = [];
         psNameToIndexMap = {};
         totalAllBallots = 0;
         stopAutoRefreshCheck(); // Stop checking
         googleSheetUrlUsed = null; // Clear URL

         resetUIOnly();
         ballotSummaryLabel.textContent = 'Load data to see totals.';
         googleSheetUrlInput.value = '';
         ballotSearchInput.value = '';
         psSearchInput.value = '';

         if (clearStatus) {
            statusLabel.textContent = 'No data loaded.';
         }
         updateNotificationArea.textContent = ''; // Clear notification

         setControlsState(isLoading); // Update controls (usually false after reset)
     }

    // --- Auto-Refresh Logic ---

    /**
     * Stops the periodic check for Google Sheet updates.
     */
    function stopAutoRefreshCheck() {
        if (autoRefreshIntervalId) {
            clearInterval(autoRefreshIntervalId);
            autoRefreshIntervalId = null;
            // console.log("Stopped auto-refresh check.");
        }
         // Optionally clear the notification when stopping implicitly
         // updateNotificationArea.textContent = '';
    }

    /**
     * Starts the periodic check for Google Sheet updates.
     * @param {string} url - The Google Sheet URL to check.
     */
    function startAutoRefreshCheck(url) {
        stopAutoRefreshCheck(); // Clear any existing timer first
        if (!url) return; // Don't start if no URL is provided

        // console.log(`Starting auto-refresh check for ${url} every ${REFRESH_CHECK_INTERVAL / 1000}s`);
        autoRefreshIntervalId = setInterval(async () => {
            await checkForUpdates(url);
        }, REFRESH_CHECK_INTERVAL);
    }

    /**
     * Fetches data from the URL and compares it to the currently loaded data.
     * Shows a notification if changes are detected.
     * @param {string} url - The Google Sheet URL to check.
     */
    async function checkForUpdates(url) {
        if (isLoading || isCheckingForUpdates || !url) {
            // Don't check if a main load is happening, or another check is in progress, or url is invalid
            return;
        }

        isCheckingForUpdates = true;
        // console.log("Checking for updates...");

        try {
            const response = await fetch(url + '&t=' + Date.now()); // Add timestamp to try bypassing cache
            if (!response.ok) {
                // Don't notify user about background check failures, just log
                console.warn(`Auto-check failed: Status ${response.status}`);
                return; // Exit check function
            }
            const csvText = await response.text();
            if (!csvText) {
                 console.warn("Auto-check failed: Fetched data is empty.");
                 return;
            }

            const workbook = XLSX.read(csvText, { type: 'string', raw: true });
            const sheetName = workbook.SheetNames[0];
            if (!sheetName) {
                 console.warn("Auto-check failed: Could not parse CSV data.");
                 return;
            }
            const newData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
            const newDataString = JSON.stringify(newData);

            // Compare stringified versions of the raw data
            if (newDataString !== originalRawDataString) {
                console.log("Data has changed on the server!");
                updateNotificationArea.textContent = "Source data updated! Reload to see changes.";
                // Optional: Stop checking once an update is found to avoid repeated notifications
                 // stopAutoRefreshCheck();
            } else {
                 // console.log("No changes detected.");
                 // Optionally clear notification if data matches again (e.g., user reloaded elsewhere)
                 // updateNotificationArea.textContent = '';
            }

        } catch (error) {
            // Log background errors silently
            console.error("Error during auto-check:", error);
        } finally {
            isCheckingForUpdates = false; // Allow next check
        }
    }


    // --- Initial Setup ---
    setControlsState(false); // Initial state: not loading, no data
    document.title = 'Ballot Paper Requirements';
    updateNotificationArea.textContent = ''; // Ensure notification area is clear initially

}); // End DOMContentLoaded