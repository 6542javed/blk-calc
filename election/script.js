document.addEventListener('DOMContentLoaded', () => {
    // --- Global State ---
    let rawData = [];
    let processedData = [];
    let psNames = [];
    let psNameToIndexMap = {};
    let currentView = 'ballot_count'; // Default view
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

    // Contestant Names UI Elements (Keep references even if view switching is disabled)
    const contestantNamesView = document.getElementById('contestant-names-view');
    const psSearchInput = document.getElementById('psSearchInput');
    const psList = document.getElementById('psList');
    const zpcCandidateList = document.getElementById('zpcCandidateList');
    const apCandidateList = document.getElementById('apCandidateList');
    const wardCandidateList = document.getElementById('wardCandidateList');

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
        // Don't reset file input here, only after successful manual load
        // fileInput.value = '';
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
                const rawSheetData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' }); // Renamed to avoid conflict
                if (!rawSheetData.length) throw new Error(`Sheet '${sheetName}' is empty.`);
                const headers = Object.keys(rawSheetData[0] || {});
                const psNameHeader = headers.find(h => h.trim().toLowerCase() === 'ps name');
                if (!psNameHeader) throw new Error("Required column 'PS Name' not found.");

                // Assign to global rawData *after* validation
                rawData = rawSheetData;
                processRawData(rawData, psNameHeader);
                updateAllUIs();
                statusLabel.textContent = `Loaded ${processedData.length} unique PS from: ${file.name}`;
                fileInput.value = ''; // Reset file input *after* successful load
            } catch (error) {
                handleLoadingError(error, "Error processing Excel file");
                 fileInput.value = ''; // Also reset on error
            } finally {
                endLoading();
            }
        };
        reader.onerror = (e) => {
            console.error("FileReader error:", e);
            handleLoadingError(new Error("An error occurred while trying to read the file."), "File Read Error");
            endLoading(); // Ensure loading state is reset even on reader error
             fileInput.value = ''; // Also reset on error
        };
        reader.readAsArrayBuffer(file);
    }

    /**
     * Handles loading data from Google Sheet URL.
     */
    async function handleUrlLoad() {
        let url = googleSheetUrlInput.value.trim();
        if (!url) {
            alert("Please paste a Google Sheet 'Publish to web' CSV URL first.");
            return;
        }
        if (!url.includes('/pub?') || !url.includes('output=csv')) {
             console.warn("URL format might be incorrect. Expected a Google Sheet 'Publish to web' CSV link. Attempting anyway...");
        }

        if (!startLoading(`Loading from URL...`)) return;

        try {
            console.log("Fetching URL with cache: 'no-store'");
            const response = await fetch(url, { cache: 'no-store' });

            if (!response.ok) {
                throw new Error(`Failed to fetch data. Status: ${response.status} ${response.statusText}. Ensure link is correct and published publicly.`);
            }
            const csvText = await response.text();
            if (!csvText) {
                 throw new Error("Fetched data is empty. Check the Google Sheet or link.");
            }

            const workbook = XLSX.read(csvText, { type: 'string', raw: true }); // Let SheetJS detect CSV
            const sheetName = workbook.SheetNames[0];
            if (!sheetName) throw new Error("Could not parse CSV data.");
            const rawSheetData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' }); // Renamed
             if (!rawSheetData.length) throw new Error("CSV data is empty after parsing.");

            const headers = Object.keys(rawSheetData[0] || {});
            const psNameHeader = headers.find(h => h.trim().toLowerCase() === 'ps name');
            if (!psNameHeader) throw new Error("Required column 'PS Name' not found in the CSV data.");

            // Assign to global rawData *after* validation
            rawData = rawSheetData;
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
     * Handles loading the default data.tsv file from the same directory.
     * This is called automatically on page load.
     */
    async function loadDefaultTsv() {
        const tsvFileName = 'data.tsv'; // Define the default filename
        if (!startLoading(`Loading default data from ${tsvFileName}...`)) return;

        try {
            console.log(`Fetching default file '${tsvFileName}' with cache: 'no-store'`);
            // Fetch from the relative path (same directory as HTML/JS)
            const response = await fetch(tsvFileName, { cache: 'no-store' });

            if (!response.ok) {
                 // Provide a more specific error message if the file is not found
                 if (response.status === 404) {
                    throw new Error(`Default data file '${tsvFileName}' not found in the application directory. Please use the upload or URL options.`);
                 } else {
                    throw new Error(`Failed to fetch default data file '${tsvFileName}'. Status: ${response.status} ${response.statusText}.`);
                 }
            }

            const tsvText = await response.text();
            if (!tsvText) {
                 throw new Error(`Default data file '${tsvFileName}' is empty.`);
            }

            // Use SheetJS to parse the TSV string
            // IMPORTANT: Specify the field separator (FS) as tab ('\t')
            const workbook = XLSX.read(tsvText, { type: 'string', raw: true, FS: "\t" });
            const sheetName = workbook.SheetNames[0];
            if (!sheetName) throw new Error(`Could not parse TSV data from '${tsvFileName}'.`);
            const rawSheetData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' }); // Renamed
             if (!rawSheetData.length) throw new Error(`TSV data in '${tsvFileName}' is empty after parsing.`);

            const headers = Object.keys(rawSheetData[0] || {});
            const psNameHeader = headers.find(h => h.trim().toLowerCase() === 'ps name');
            if (!psNameHeader) throw new Error(`Required column 'PS Name' not found in the default data file '${tsvFileName}'.`);

            // Assign to global rawData *after* validation
            rawData = rawSheetData;
            processRawData(rawData, psNameHeader);
            updateAllUIs();
            statusLabel.textContent = `Loaded ${processedData.length} unique PS from default file (${tsvFileName}).`;

        } catch (error) {
            // For default load errors, keep controls enabled so user can try other methods
            handleLoadingError(error, `Error loading default data (${tsvFileName})`, false); // Pass 'false' to keep controls enabled
        } finally {
            endLoading(); // Ensure loading state is cleared and controls potentially re-enabled
        }
    }


    /**
     * Centralized error handling for loading processes.
     * @param {Error} error - The error object.
     * @param {string} [contextMessage="Error"] - A message indicating the context of the error.
     * @param {boolean} [fullReset=true] - Whether to fully reset the application state (clearing data). Default is true.
     *                                      Set to false for default load errors to allow other load methods.
     */
    function handleLoadingError(error, contextMessage = "Error", fullReset = true) {
         console.error(`${contextMessage}:`, error);
         const displayMessage = `Error: ${error.message}`;
         statusLabel.textContent = displayMessage;
         alert(`${contextMessage}:\n${error.message}`);

         if (fullReset) {
            resetApplicationState(false); // Reset state but keep the error message
         } else {
            // If not a full reset (e.g., default load failed), just clear the UI
            // but leave controls enabled so user can try file/URL upload.
            resetUIOnly();
            ballotSummaryLabel.textContent = 'Load data to see totals.';
            statusLabel.textContent = `${displayMessage} Use other load options.`; // Keep error but add context
            // Ensure controls are enabled after the error for non-full resets
            isLoading = false; // Explicitly set isLoading false here
            setControlsState(false); // Enable controls
         }
    }


     /**
     * Cleans raw data, handles duplicates, calculates necessary values.
     * @param {object[]} sourceData - Data array from SheetJS (JSON).
     * @param {string} psNameKey - The exact key found for 'PS Name'.
     */
    function processRawData(sourceData, psNameKey) {
        // Reset global state related to processed data before processing new data
        processedData = [];
        psNameToIndexMap = {};
        psNames = [];
        totalAllBallots = 0; // Reset total count as well

        const seenPsNames = new Set();

        sourceData.forEach((rawRow, index) => {
            const originalPsName = String(rawRow[psNameKey] || '').trim();
            if (!originalPsName) {
                // console.warn(`Skipping row ${index + 2} (source) due to empty PS Name.`);
                return;
            }
            // Normalize PS Name for duplicate checking (e.g., trim extra spaces)
            const normalizedPsName = originalPsName.replace(/\s+/g, ' ').trim();
            if (seenPsNames.has(normalizedPsName)) {
                 // console.warn(`Skipping duplicate PS Name: "${originalPsName}" (normalized: "${normalizedPsName}") at row ${index + 2} (source).`);
                 return;
            }
            seenPsNames.add(normalizedPsName);

            const processedRow = {
                originalIndex: index,
                psName: originalPsName, // Store the original name for display
                voters: safeParseInt(findValueCaseInsensitive(rawRow, 'Total Number of Voter') || '0'),
                candidates: {},
                ballotInfo: {}
            };

            // Find candidate names using case-insensitive helper if needed, or stick to prefix
            // Using getCandidateNamesJS as it relies on specific prefixes (ZPM, APM, GPM)
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
            // Accumulate total ballots here after processing each valid row
            totalAllBallots += processedRow.ballotInfo.psTotal;
        });

        // Sort processed data alphabetically by PS Name
        processedData.sort((a, b) => a.psName.localeCompare(b.psName));

        // Rebuild the index map and psNames array after sorting
        processedData.forEach((row, newIndex) => {
             psNames.push(row.psName);
             psNameToIndexMap[row.psName] = newIndex;
        });

        console.log(`Processed ${processedData.length} unique PS entries. Total ballots: ${totalAllBallots}`);
    }


    /**
     * Central function to trigger updates for both UI views.
     */
     function updateAllUIs() {
         updateBallotTableUI(); // This will use the globally calculated totalAllBallots
         populatePsListUI();
         clearCandidateColumnsUI();
         const previouslySelected = psList.querySelector('.selected');
         if (previouslySelected) {
             previouslySelected.classList.remove('selected');
         }
     }

    // --- UI Update Functions ---
    function updateBallotTableUI() {
        ballotTableBody.innerHTML = '';
        // totalAllBallots is now calculated during processRawData
        if (!processedData.length) {
            ballotSummaryLabel.textContent = 'No data loaded or processed.';
            return;
        }
        processedData.forEach((row, index) => {
            // No need to recalculate total here
            const tr = document.createElement('tr');
            tr.dataset.rowIndex = index; // Use the index *after sorting*
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
        // Display the pre-calculated total
        ballotSummaryLabel.textContent = `Total Ballots Required (all ${processedData.length} PS): ${totalAllBallots.toLocaleString()}`;
    }

    function filterBallotTable() {
        const searchTerm = ballotSearchInput.value.trim().toLowerCase();
        const rows = ballotTableBody.getElementsByTagName('tr');
        let visibleRowCount = 0;
        let visibleTotalBallots = 0; // Recalculate visible total for summary if needed

        for (const row of rows) {
            const psNameCell = row.cells[1]; // PS Name is in the second cell (index 1)
            let isVisible = false;
            if (psNameCell) {
                const psName = psNameCell.textContent.toLowerCase();
                isVisible = psName.includes(searchTerm);
                row.classList.toggle('hidden', !isVisible);
            } else {
                row.classList.add('hidden'); // Hide rows without a PS Name cell if any exist
            }

            // If row is visible, update counts
            if (isVisible && row.dataset.rowIndex !== undefined) {
                visibleRowCount++;
                const rowIndex = parseInt(row.dataset.rowIndex, 10);
                if (rowIndex >= 0 && rowIndex < processedData.length) {
                    visibleTotalBallots += processedData[rowIndex].ballotInfo.psTotal;
                }
            }
        }

        // Update summary label based on filter
        if (searchTerm) {
             ballotSummaryLabel.textContent = `Total Ballots (Filtered - ${visibleRowCount} PS): ${visibleTotalBallots.toLocaleString()} / Total (all ${processedData.length} PS): ${totalAllBallots.toLocaleString()}`;
        } else {
             ballotSummaryLabel.textContent = `Total Ballots Required (all ${processedData.length} PS): ${totalAllBallots.toLocaleString()}`;
        }
    }

    // Tooltip Handlers (Unchanged)
    function handleTableMouseOver(event) {
        const row = event.target.closest('tr');
        if (row && row.dataset.rowIndex !== undefined) {
            const rowIndex = parseInt(row.dataset.rowIndex, 10);
            if (rowIndex >= 0 && rowIndex < processedData.length){
                const rowData = processedData[rowIndex];
                const zpcText = rowData.candidates.zpc.length > 0 ? rowData.candidates.zpc.join(', ') : 'Uncontested or Nil';
                const apText = rowData.candidates.ap.length > 0 ? rowData.candidates.ap.join(', ') : 'Uncontested or Nil';
                const wardText = rowData.candidates.ward.length > 0 ? rowData.candidates.ward.join(', ') : 'Uncontested or Nil';
                tooltipElement.innerHTML = `<strong>ZPC:</strong> ${zpcText}<br><strong>AP:</strong> ${apText}<br><strong>Ward:</strong> ${wardText}`; // Use innerHTML for breaks
                tooltipElement.style.display = 'block';
            } else { tooltipElement.style.display = 'none'; }
        } else { tooltipElement.style.display = 'none'; }
    }
    function handleTableMouseOut(event) {
         const relatedTarget = event.relatedTarget;
         // Hide if moving outside the table body entirely, or onto the tooltip itself briefly
         if (!ballotTableBody.contains(relatedTarget) || relatedTarget === tooltipElement) {
            // A small delay can prevent flickering if moving quickly over adjacent cells
            setTimeout(() => {
                // Check again in case the mouse quickly re-entered another row
                if (tooltipElement.style.display === 'block' && !ballotTableBody.matches(':hover')) {
                     tooltipElement.style.display = 'none';
                }
            }, 50);
         }
    }
    function handleTableMouseMove(event) {
        if (tooltipElement.style.display === 'block') {
            const xOffset = 15, yOffset = 10;
            // Adjust position to prevent tooltip going off-screen
            const chartRect = ballotCountView.getBoundingClientRect(); // Or use body/window
            const tipWidth = tooltipElement.offsetWidth;
            const tipHeight = tooltipElement.offsetHeight;

            let left = event.pageX + xOffset;
            let top = event.pageY + yOffset;

            // Check horizontal boundaries
            if (left + tipWidth > window.innerWidth + window.scrollX - xOffset) {
                left = event.pageX - tipWidth - xOffset; // Place to the left
            }
            // Check vertical boundaries
            if (top + tipHeight > window.innerHeight + window.scrollY - yOffset) {
                top = event.pageY - tipHeight - yOffset; // Place above
            }

            tooltipElement.style.left = `${left}px`;
            tooltipElement.style.top = `${top}px`;
        }
    }

    // PS List and Candidate Column UI Functions (Unchanged)
    function populatePsListUI() {
        psList.innerHTML = '';
        psSearchInput.value = ''; // Clear search when repopulating
        if (!psNames.length) return;
        psNames.forEach((name) => {
            const li = document.createElement('li');
            li.textContent = name;
            li.dataset.psName = name;
            psList.appendChild(li);
        });
        filterPsList(); // Apply filter in case search input still has value (though cleared above)
    }
    function filterPsList() {
        const searchTerm = psSearchInput.value.trim().toLowerCase();
        const items = psList.getElementsByTagName('li');
        let firstVisible = null; // Track the first visible item

        for (const item of items) {
            const psName = item.dataset.psName.toLowerCase(); // Use data-ps-name for consistency
            const isVisible = psName.includes(searchTerm);
            item.classList.toggle('hidden', !isVisible);
            if (isVisible && !firstVisible) {
                firstVisible = item;
            }
        }
         // Optional: Automatically select the first visible item if search yields results
         // const previouslySelected = psList.querySelector('.selected');
         // if (firstVisible && (!previouslySelected || previouslySelected.classList.contains('hidden'))) {
         //    if (previouslySelected) previouslySelected.classList.remove('selected');
         //    firstVisible.classList.add('selected');
         //    handlePsSelect({ target: firstVisible }); // Trigger update
         // } else if (!firstVisible && previouslySelected) {
         //    // If search yields no results, clear selection and candidate view
         //    previouslySelected.classList.remove('selected');
         //    clearCandidateColumnsUI();
         // }
    }
    function handlePsSelect(event) {
        if (event.target.tagName === 'LI' && !event.target.classList.contains('hidden')) { // Only select visible items
            const selectedLi = event.target;
            const psName = selectedLi.dataset.psName;
            const previouslySelected = psList.querySelector('.selected');

            if (previouslySelected === selectedLi) return; // Clicked same item again

            if (previouslySelected) previouslySelected.classList.remove('selected');
            selectedLi.classList.add('selected');

            if (psName && psNameToIndexMap.hasOwnProperty(psName)) {
                const index = psNameToIndexMap[psName];
                if(index >= 0 && index < processedData.length){
                    updateCandidateColumnsUI(processedData[index].candidates);
                } else {
                    console.warn(`Index ${index} out of bounds for PS Name: ${psName}`);
                    clearCandidateColumnsUI();
                }
            } else {
                console.warn(`PS Name not found in map: ${psName}`);
                clearCandidateColumnsUI();
            }
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
     * (Unchanged from previous correct version)
     */
     function exportBallotTable() {
        if (!processedData.length) {
            alert("No data available to export."); return;
        }
        const dataToExport = [];
        // Explicitly define headers in the desired order
        const headers = ["No.", "PS Name", "Total Voters", "ZPC Ballot", "Total ZPC Ballots", "AP Ballot", "Total AP Ballots", "Ward Ballot", "Total Ward Ballots", "Total Ballots"];
        const rows = ballotTableBody.getElementsByTagName('tr');
        let visibleRowCount = 0;
        let visibleTotalBallots = 0;

        // Add header row to the export array first
        // dataToExport.push(headers); // SheetJS adds headers by default from keys

        for (const row of rows) {
             if (!row.classList.contains('hidden')) { // Only export visible rows
                visibleRowCount++;
                const rowIndex = parseInt(row.dataset.rowIndex, 10);
                 if (rowIndex >= 0 && rowIndex < processedData.length) {
                    const rowData = processedData[rowIndex];
                    visibleTotalBallots += rowData.ballotInfo.psTotal;
                    // Create object with keys matching headers for json_to_sheet
                    dataToExport.push({
                        [headers[0]]: visibleRowCount, // Use visible count for "No."
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
        if (!dataToExport.length) {
            alert("No data currently visible in the table to export (check filter?)."); return;
        }
        // Add summary row at the end
        dataToExport.push({}); // Add an empty row for spacing
        dataToExport.push({
            [headers[1]]: `Visible Rows Total (${visibleRowCount})`, // Add count to label
            [headers[9]]: visibleTotalBallots // Sum of 'Total Ballots' for visible rows
        });

        try {
            // Use json_to_sheet with explicit header order
            const ws = XLSX.utils.json_to_sheet(dataToExport, { header: headers, skipHeader: false });

            // --- Optional: Column Widths ---
             const colWidths = [
                 { wch: 5 },  // No.
                 { wch: 35 }, // PS Name
                 { wch: 15 }, // Total Voters
                 { wch: 10 }, // ZPC Ballot
                 { wch: 18 }, // Total ZPC Ballots
                 { wch: 10 }, // AP Ballot
                 { wch: 18 }, // Total AP Ballots
                 { wch: 12 }, // Ward Ballot
                 { wch: 18 }, // Total Ward Ballots
                 { wch: 15 }  // Total Ballots
             ];
             ws['!cols'] = colWidths;
            // --- End Optional ---

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
     * NOTE: Functionality is currently bypassed by the 'return' statement.
     */
    function switchView() {
        // Keep this bypassed as per the original modification request
        return;

        // If you want to re-enable view switching, remove the 'return' above.
        /*
        if (!processedData.length) {
            alert("Load data before switching views.");
            return; // Don't switch if no data
        }

        if (currentView === 'ballot_count') {
            ballotCountView.classList.remove('active-view');
            contestantNamesView.classList.add('active-view');
            currentView = 'contestant_names';
            switchViewButton.textContent = 'Switch to Ballot Count View';
            document.title = 'Polling Station Candidate Viewer';
            // Optionally populate/filter PS list when switching to this view
             // populatePsListUI(); // Already populated by updateAllUIs
             filterPsList(); // Ensure filter is applied
        } else {
            contestantNamesView.classList.remove('active-view');
            ballotCountView.classList.add('active-view');
            currentView = 'ballot_count';
            switchViewButton.textContent = 'Switch to Contestant View';
            document.title = 'Ballot Paper Requirements';
             // Optionally filter ballot table when switching back
             filterBallotTable();
        }
        */
    }

    /**
      * Sets the enabled/disabled state of UI controls based on loading status and data presence.
      * @param {boolean} loading - Is data currently being loaded?
      */
    function setControlsState(loading) {
        const hasData = processedData && processedData.length > 0;

        // --- Input Controls ---
        // Disabled *only* when actively loading
        loadFromUrlButton.disabled = loading;
        fileInput.disabled = loading;
        if (fileInputLabel) {
            fileInputLabel.classList.toggle('button-disabled', loading);
        }
        googleSheetUrlInput.disabled = loading; // Disable URL input during any load

        // --- Action/View Controls ---
        // Disabled if loading OR if there's no data
        exportButton.disabled = loading || !hasData;
        ballotSearchInput.disabled = loading || !hasData;
        ballotSearchButton.disabled = loading || !hasData;
        psSearchInput.disabled = loading || !hasData;
        // Switch view button might be enabled even without data, but the switch logic prevents it.
        // Let's disable it too if no data or loading.
        switchViewButton.disabled = loading || !hasData;


        // --- Clear inputs/filters when disabling ---
        if (loading || !hasData) {
            ballotSearchInput.value = '';
            psSearchInput.value = '';
             // Re-apply filters to clear visual state if controls are disabled
             if (ballotTableBody.hasChildNodes()) filterBallotTable();
             if (psList.hasChildNodes()) filterPsList();
             if(!hasData) clearCandidateColumnsUI(); // Clear candidate view if no data
        }
    }


    /**
     * Resets the application state (clears data, UI, disables controls).
     * @param {boolean} [clearStatus=true] - Whether to reset the status label.
     */
     function resetApplicationState(clearStatus = true) {
         // Clear data structures
         rawData = [];
         processedData = [];
         psNames = [];
         psNameToIndexMap = {};
         totalAllBallots = 0;
         // isLoading should be handled by start/end loading, ensure it's false here
         isLoading = false;

         // Reset UI elements
         resetUIOnly(); // Clear tables/lists
         ballotSummaryLabel.textContent = 'Load data to see totals.';
         googleSheetUrlInput.value = ''; // Clear URL input
         fileInput.value = ''; // Clear file input selection state
         ballotSearchInput.value = ''; // Clear search fields
         psSearchInput.value = '';

         if (clearStatus) {
            statusLabel.textContent = 'No data loaded. Load default, upload file, or use URL.'; // Updated message
         }

         // Update control states (will disable data-dependent controls)
         setControlsState(false); // Not loading, no data
     }


    // --- Initial Setup ---
    console.log("DOM Content Loaded. Initializing...");
    setControlsState(true); // Start with controls disabled *until* default load attempt finishes
    document.title = 'Ballot Paper Requirements'; // Set default title
    ballotCountView.classList.add('active-view'); // Ensure ballot view is active by default
    contestantNamesView.classList.remove('active-view'); // Ensure other view is hidden

    // Attempt to load the default TSV file automatically
    loadDefaultTsv(); // This will handle start/end loading and update controls via endLoading/handleLoadingError

}); // End DOMContentLoaded