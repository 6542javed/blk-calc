document.addEventListener('DOMContentLoaded', () => {
    // --- Global State ---
    let rawData = [];
    let processedData = []; // Used for Ballot Table and Candidate Display
    let psNames = [];       // Used for old PS List (kept for now)
    let psNameToIndexMap = {}; // Used for old PS List and finding data for candidate view
    let currentView = 'ballot_count';
    let totalAllBallots = 0;
    let isLoading = false; // Flag to prevent concurrent loading

    // --- NEW: Hierarchy State ---
    let hierarchy = new Map(); // Map<zpc, Map<ap, Map<gp, Map<ward, Set<ps>>>>>
    let headerMap = {}; // To store actual header names found (including No. columns)
    let psNameToProcessedIndexMap = new Map(); // Map<formattedPsName, processedDataIndex>

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
    const zpcCandidateList = document.getElementById('zpcCandidateList');
    const apCandidateList = document.getElementById('apCandidateList');
    const wardCandidateList = document.getElementById('wardCandidateList');

    // --- OLD PS List Elements (Kept but hidden) ---
    const psSearchInput = document.getElementById('psSearchInput');
    const psList = document.getElementById('psList');

    // --- NEW Hierarchical Dropdown Elements ---
    const zpcSelect = document.getElementById('zpcSelect');
    const apSelect = document.getElementById('apSelect');
    const gpSelect = document.getElementById('gpSelect');
    const wardSelect = document.getElementById('wardSelect');
    const psSelect = document.getElementById('psSelect');

    // --- Constants ---
    const ZPC_KEY = 'zpc name';
    const AP_KEY = 'ap name';
    const GP_KEY = 'gp name';
    const WARD_KEY = 'ward name';
    const PS_KEY = 'ps name';
    const VOTER_KEY = 'total number of voter'; // Key for voters in processedData
    const ZPC_NO_KEY = 'zpc no.';
    const AP_NO_KEY = 'ap no.';
    const GP_NO_KEY = 'gp no.';
    const WARD_NO_KEY = 'ward no.';
    const PS_NO_KEY = 'ps no.';

    // All required keys for data processing and hierarchy
    const REQ_KEYS = [
        ZPC_KEY, AP_KEY, GP_KEY, WARD_KEY, PS_KEY,
        ZPC_NO_KEY, AP_NO_KEY, GP_NO_KEY, WARD_NO_KEY, PS_NO_KEY,
        VOTER_KEY // Voter count is needed for processedData
        // Candidate keys (ZPM*, APM*, GPM*) are handled separately by getCandidateNamesJS
    ];


    // --- Utility Functions ---

    function getCandidateNamesJS(row, prefix) {
        const candidates = [];
        if (!row) return candidates;
        const lowerPrefix = prefix.toLowerCase();
        for (const key in row) {
            // Use case-insensitive comparison for prefix
            if (Object.hasOwnProperty.call(row, key) && typeof key === 'string' && key.toLowerCase().startsWith(lowerPrefix)) {
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

    // --- NEW: Utility Functions from dropdown-test ---
    function findHeaderKey(headers, targetKey) {
        const lowerTarget = targetKey.toLowerCase().trim();
        for (const header of headers) {
            if (String(header).toLowerCase().trim() === lowerTarget) {
                return header; // Return the exact header name found
            }
        }
        return null; // Not found
    }

    function populateDropdown(selectElement, options, placeholder) {
        selectElement.innerHTML = `<option value="">-- ${placeholder} --</option>`; // Clear existing options
        options.sort((a, b) => a.localeCompare(b)); // Sort options alphabetically
        options.forEach(option => {
            const opt = document.createElement('option');
            opt.value = option;
            opt.textContent = option;
            selectElement.appendChild(opt);
        });
        selectElement.disabled = !options.length; // Disable if no options
        if (!options.length) {
            selectElement.innerHTML = `<option value="">-- No options available --</option>`;
        }
    }

    function resetDropdown(selectElement, placeholder) {
         selectElement.innerHTML = `<option value="">-- ${placeholder} --</option>`;
         selectElement.disabled = true;
         selectElement.value = ""; // Reset selection
    }

    function resetAllDropdowns() {
        resetDropdown(zpcSelect, 'Select ZPC');
        resetDropdown(apSelect, 'Select AP');
        resetDropdown(gpSelect, 'Select GP');
        resetDropdown(wardSelect, 'Select Ward');
        resetDropdown(psSelect, 'Select PS');
        clearCandidateColumnsUI(); // Also clear candidates when dropdowns reset
    }

    function formatNoName(no, name) {
        const numStr = String(no || '').trim();
        const nameStr = String(name || '').trim();

        if (numStr && nameStr) {
            return `${numStr} - ${nameStr}`;
        } else if (nameStr) {
            return nameStr; // Fallback to just name
        } else if (numStr) {
            return numStr; // Fallback to just no
        } else {
            return '';
        }
    }

    // --- Event Listeners ---
    fileInput.addEventListener('change', handleFileLoad);
    loadFromUrlButton.addEventListener('click', handleUrlLoad);
    switchViewButton.addEventListener('click', switchView);
    exportButton.addEventListener('click', exportBallotTable);
    ballotSearchButton.addEventListener('click', filterBallotTable);
    ballotSearchInput.addEventListener('input', filterBallotTable);
    ballotTableBody.addEventListener('mouseover', handleTableMouseOver);
    ballotTableBody.addEventListener('mouseout', handleTableMouseOut);
    ballotTableBody.addEventListener('mousemove', handleTableMouseMove);

    // --- OLD PS List Listeners (Kept but associated UI hidden) ---
    psSearchInput.addEventListener('input', filterPsList);
    psList.addEventListener('click', handlePsSelect);

    // --- NEW Dropdown Listeners ---
    zpcSelect.addEventListener('change', handleZpcChange);
    apSelect.addEventListener('change', handleApChange);
    gpSelect.addEventListener('change', handleGpChange);
    wardSelect.addEventListener('change', handleWardChange);
    psSelect.addEventListener('change', handlePsChange); // Listener for the final PS selection

    // --- Core Logic Functions ---

    function startLoading(message = 'Loading data...') {
        if (isLoading) {
            console.warn("Already loading data.");
            return false;
        }
        isLoading = true;
        statusLabel.textContent = message;
        setControlsState(true);
        resetUIOnly();
        return true;
    }

    function endLoading() {
        isLoading = false;
        setControlsState(false);
        fileInput.value = '';
    }

    function resetUIOnly() {
        ballotTableBody.innerHTML = '';
        // psList.innerHTML = ''; // Keep old list data intact if needed
        clearCandidateColumnsUI();
        resetAllDropdowns(); // Reset the new dropdowns
        ballotSummaryLabel.textContent = 'Processing...';
        tooltipElement.style.display = 'none';
    }

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
                const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null }); // Use null
                if (!jsonData.length) throw new Error(`Sheet '${sheetName}' is empty.`);

                // Validate headers
                const headers = Object.keys(jsonData[0] || {});
                const missingKeys = checkRequiredHeaders(headers);
                if (missingKeys.length > 0) {
                    throw new Error(`Required columns not found: ${missingKeys.join(', ')}`);
                }

                rawData = jsonData; // Store raw data
                processAllData(); // Process for both ballot table and hierarchy
                updateAllUIs();   // Update tables, lists, dropdowns
                statusLabel.textContent = `Loaded ${processedData.length} unique PS from: ${file.name}. Select ZPC to view candidates.`;

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

    async function handleUrlLoad() {
        let url = googleSheetUrlInput.value.trim();
        if (!url) {
            alert("Please paste a Google Sheet 'Publish to web' CSV URL first.");
            return;
        }
        if (!url.includes('/pub?') || !url.includes('output=csv')) {
             console.warn("URL format might be incorrect. Attempting to load anyway...");
        }
        if (!startLoading(`Loading from URL...`)) return;

        try {
            console.log("Fetching URL with cache: 'no-store'");
            const response = await fetch(url, { cache: 'no-store' });

            if (!response.ok) {
                throw new Error(`Failed to fetch. Status: ${response.status} ${response.statusText}. Check URL & permissions.`);
            }
            let csvText = await response.text();
            if (!csvText) {
                 throw new Error("Fetched data is empty.");
            }

            // --- NEW: Limit lines read ---
            const lines = csvText.split('\\n');
            if (lines.length > 252) {
                console.warn(`Limiting CSV input from ${lines.length} lines to 252.`);
                csvText = lines.slice(0, 252).join('\\n');
            }
            // --- END: Limit lines read ---

            const workbook = XLSX.read(csvText, { type: 'string', raw: true });
            const sheetName = workbook.SheetNames[0];
            if (!sheetName) throw new Error("Could not parse CSV data.");
            const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null }); // Use null
            if (!jsonData.length) throw new Error("CSV data is empty after parsing.");

            // Validate headers
            const headers = Object.keys(jsonData[0] || {});
            const missingKeys = checkRequiredHeaders(headers);
             if (missingKeys.length > 0) {
                 throw new Error(`Required columns not found: ${missingKeys.join(', ')}`);
             }

            rawData = jsonData; // Store raw data
            processAllData(); // Process for both ballot table and hierarchy
            updateAllUIs();   // Update tables, lists, dropdowns
            statusLabel.textContent = `Loaded ${processedData.length} unique PS from URL. Select ZPC to view candidates.`;

        } catch (error) {
             handleLoadingError(error, "Error loading from URL");
        } finally {
            endLoading();
        }
    }

    function handleLoadingError(error, contextMessage = "Error") {
         console.error(`${contextMessage}:`, error);
         statusLabel.textContent = `Error: ${error.message}`;
         alert(`${contextMessage}:\n${error.message}`);
         resetApplicationState(false);
    }

    // --- NEW: Header Validation ---
    function checkRequiredHeaders(headers) {
        headerMap = {}; // Reset header map
        let missingKeys = [];
        REQ_KEYS.forEach(key => {
            const foundKey = findHeaderKey(headers, key);
            if (foundKey) {
                headerMap[key] = foundKey; // Store the actual found header name
            } else {
                missingKeys.push(key.toUpperCase());
            }
        });
        return missingKeys;
    }

    // --- NEW: Combined Data Processing ---
    function processAllData() {
        processRawDataForBallotTable(); // Original processing for ballot table
        processHierarchyData();         // New processing for dropdown hierarchy
        // Build map from formatted PS Name to index in processedData for quick lookup
        buildPsNameToIndexMap();
    }

    /**
     * Processes raw data specifically for the ballot count table and candidate lists.
     * (Mostly unchanged, but uses headerMap now)
     */
    function processRawDataForBallotTable() {
        processedData = [];
        // psNameToIndexMap = {}; // This map is now built in buildPsNameToIndexMap
        psNames = [];          // Still used for the old list
        const seenPsNames = new Set(); // Track based on formatted name for uniqueness

        rawData.forEach((rawRow, index) => {
            const psFormattedName = formatNoName(rawRow[headerMap[PS_NO_KEY]], rawRow[headerMap[PS_KEY]]);
             if (!psFormattedName) {
                 // console.warn(`Skipping row ${index + 2} (source) due to empty PS Name/No.`);
                 return;
             }
             if (seenPsNames.has(psFormattedName)) {
                 // console.warn(`Skipping duplicate PS Name: "${psFormattedName}" at row ${index + 2} (source).`);
                 return;
             }
             seenPsNames.add(psFormattedName);

             const processedRow = {
                 originalIndex: index,
                 psName: psFormattedName, // Store the formatted name here now
                 voters: safeParseInt(rawRow[headerMap[VOTER_KEY]] || '0'),
                 candidates: {},
                 ballotInfo: {}
             };

             // Candidate extraction remains the same, using prefixes
             processedRow.candidates.zpc = getCandidateNamesJS(rawRow, 'ZPM'); // Use original prefix
             processedRow.candidates.ap = getCandidateNamesJS(rawRow, 'APM');
             processedRow.candidates.ward = getCandidateNamesJS(rawRow, 'GPM');

             // Ballot calc remains the same
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

        // Sort processed data by the formatted PS name
        processedData.sort((a, b) => a.psName.localeCompare(b.psName));

        // Populate psNames for the old list (using the formatted name)
        processedData.forEach((row) => {
             psNames.push(row.psName);
             // psNameToIndexMap is built later
        });
         console.log("Processed Data for Ballot Table:", processedData);
    }

    /**
     * Processes raw data to build the hierarchical structure for dropdowns.
     * (Adapted from dropdown-test.html)
     */
    function processHierarchyData() {
        hierarchy.clear(); // Ensure it's empty

        rawData.forEach(row => {
            const zpcName = formatNoName(row[headerMap[ZPC_NO_KEY]], row[headerMap[ZPC_KEY]]);
            const apName = formatNoName(row[headerMap[AP_NO_KEY]], row[headerMap[AP_KEY]]);
            const gpName = formatNoName(row[headerMap[GP_NO_KEY]], row[headerMap[GP_KEY]]);
            const wardName = formatNoName(row[headerMap[WARD_NO_KEY]], row[headerMap[WARD_KEY]]);
            const psName = formatNoName(row[headerMap[PS_NO_KEY]], row[headerMap[PS_KEY]]);

            // Only add if all levels have formatted names
            if (zpcName && apName && gpName && wardName && psName) {
                if (!hierarchy.has(zpcName)) hierarchy.set(zpcName, new Map());
                const zpcMap = hierarchy.get(zpcName);

                if (!zpcMap.has(apName)) zpcMap.set(apName, new Map());
                const apMap = zpcMap.get(apName);

                if (!apMap.has(gpName)) apMap.set(gpName, new Map());
                const gpMap = apMap.get(gpName);

                if (!gpMap.has(wardName)) gpMap.set(wardName, new Set());
                const wardSet = gpMap.get(wardName);

                wardSet.add(psName);
            }
        });
        console.log("Hierarchy built:", hierarchy);
    }

    /**
    * Creates a map from the formatted PS Name (e.g., "1 - AMBAGAN...")
    * to the index in the `processedData` array for quick lookups.
    */
    function buildPsNameToIndexMap() {
        psNameToProcessedIndexMap.clear();
        processedData.forEach((row, index) => {
            // Ensure the key exists and is not empty
            if (row.psName) {
                psNameToProcessedIndexMap.set(row.psName, index);
            }
        });
        // console.log("PS Name to Processed Index Map:", psNameToProcessedIndexMap);
    }

    /**
     * Central function to trigger updates for all UI views.
     */
     function updateAllUIs() {
         updateBallotTableUI();
         populatePsListUI();      // Update old list (hidden)
         populateZpcDropdown();   // Update new dropdowns
         clearCandidateColumnsUI(); // Clear candidate display initially
         // Clear selection visual from old list if present
         const previouslySelectedOld = psList.querySelector('.selected');
          if (previouslySelectedOld) {
              previouslySelectedOld.classList.remove('selected');
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
            // Store the index from the *sorted* processedData array
            tr.dataset.processedIndex = index;
            tr.innerHTML = `
                <td>${index + 1}</td>
                <td>${row.psName}</td> <!-- Display formatted name -->
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
            const psNameCell = row.cells[1]; // PS Name is the second cell
            if (psNameCell) {
                const psName = psNameCell.textContent.toLowerCase();
                row.classList.toggle('hidden', !psName.includes(searchTerm));
            }
        }
    }

    // Tooltip logic now uses processedIndex
    function handleTableMouseOver(event) {
        const row = event.target.closest('tr');
        if (row && row.dataset.processedIndex !== undefined) {
            const processedIndex = parseInt(row.dataset.processedIndex, 10);
            if (processedIndex >= 0 && processedIndex < processedData.length){
                const rowData = processedData[processedIndex]; // Get data using index
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

    // --- OLD PS List UI Functions (Kept but UI hidden) ---
    function populatePsListUI() {
        psList.innerHTML = '';
        psSearchInput.value = '';
        if (!psNames.length) return;
        // Populate with formatted names from psNames array
        psNames.forEach((name) => {
            const li = document.createElement('li');
            li.textContent = name;
            li.dataset.psName = name; // Store formatted name
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

    function handlePsSelect(event) { // Handles click on OLD list
        if (event.target.tagName === 'LI') {
            const selectedLi = event.target;
            const psFormattedName = selectedLi.dataset.psName; // Get formatted name
            const previouslySelected = psList.querySelector('.selected');
            if (previouslySelected) previouslySelected.classList.remove('selected');
            selectedLi.classList.add('selected');

            // Find data using the map
            if (psFormattedName && psNameToProcessedIndexMap.has(psFormattedName)) {
                const index = psNameToProcessedIndexMap.get(psFormattedName);
                 if(index >= 0 && index < processedData.length){
                     updateCandidateColumnsUI(processedData[index].candidates);
                 } else { clearCandidateColumnsUI(); }
            } else {
                console.warn(`Could not find data for selected PS (old list): ${psFormattedName}`);
                clearCandidateColumnsUI();
            }
             // Deselect dropdowns if the old list is used
            resetAllDropdowns();
        }
    }

    // --- NEW Dropdown Population & Handlers ---
    function populateZpcDropdown() {
        const zpcNames = Array.from(hierarchy.keys());
        populateDropdown(zpcSelect, zpcNames, 'Select ZPC');
        resetDropdown(apSelect, 'Select AP');
        resetDropdown(gpSelect, 'Select GP');
        resetDropdown(wardSelect, 'Select Ward');
        resetDropdown(psSelect, 'Select PS');
    }

    function handleZpcChange() {
        const selectedZpc = zpcSelect.value;
        resetDropdown(apSelect, 'Select AP');
        resetDropdown(gpSelect, 'Select GP');
        resetDropdown(wardSelect, 'Select Ward');
        resetDropdown(psSelect, 'Select PS');
        clearCandidateColumnsUI(); // Clear candidates when ZPC changes

        if (selectedZpc && hierarchy.has(selectedZpc)) {
            const apMap = hierarchy.get(selectedZpc);
            const apNames = Array.from(apMap.keys());
            populateDropdown(apSelect, apNames, 'Select AP');
        }
    }

    function handleApChange() {
        const selectedZpc = zpcSelect.value;
        const selectedAp = apSelect.value;
        resetDropdown(gpSelect, 'Select GP');
        resetDropdown(wardSelect, 'Select Ward');
        resetDropdown(psSelect, 'Select PS');
        clearCandidateColumnsUI();

        if (selectedZpc && selectedAp && hierarchy.has(selectedZpc) && hierarchy.get(selectedZpc).has(selectedAp)) {
            const gpMap = hierarchy.get(selectedZpc).get(selectedAp);
            const gpNames = Array.from(gpMap.keys());
            populateDropdown(gpSelect, gpNames, 'Select GP');
        }
    }

    function handleGpChange() {
        const selectedZpc = zpcSelect.value;
        const selectedAp = apSelect.value;
        const selectedGp = gpSelect.value;
        resetDropdown(wardSelect, 'Select Ward');
        resetDropdown(psSelect, 'Select PS');
        clearCandidateColumnsUI();

         if (selectedZpc && selectedAp && selectedGp &&
             hierarchy.has(selectedZpc) &&
             hierarchy.get(selectedZpc).has(selectedAp) &&
             hierarchy.get(selectedZpc).get(selectedAp).has(selectedGp)) {
            const wardMap = hierarchy.get(selectedZpc).get(selectedAp).get(selectedGp);
            const wardNames = Array.from(wardMap.keys());
            populateDropdown(wardSelect, wardNames, 'Select Ward');
        }
    }

    function handleWardChange() {
        const selectedZpc = zpcSelect.value;
        const selectedAp = apSelect.value;
        const selectedGp = gpSelect.value;
        const selectedWard = wardSelect.value;
        resetDropdown(psSelect, 'Select PS');
        clearCandidateColumnsUI();

        if (selectedZpc && selectedAp && selectedGp && selectedWard &&
            hierarchy.has(selectedZpc) &&
            hierarchy.get(selectedZpc).has(selectedAp) &&
            hierarchy.get(selectedZpc).get(selectedAp).has(selectedGp) &&
            hierarchy.get(selectedZpc).get(selectedAp).get(selectedGp).has(selectedWard)) {
           const psSet = hierarchy.get(selectedZpc).get(selectedAp).get(selectedGp).get(selectedWard);
           const psNamesArr = Array.from(psSet);
           populateDropdown(psSelect, psNamesArr, 'Select PS');
        }
    }

    function handlePsChange() { // Final dropdown selection
        const selectedPsFormattedName = psSelect.value;
        clearCandidateColumnsUI();

        if (selectedPsFormattedName && psNameToProcessedIndexMap.has(selectedPsFormattedName)) {
            const index = psNameToProcessedIndexMap.get(selectedPsFormattedName);
            if (index !== undefined && index >= 0 && index < processedData.length) {
                updateCandidateColumnsUI(processedData[index].candidates);
            } else {
                 console.error(`Invalid index found for PS: ${selectedPsFormattedName}`);
            }
        } else if (selectedPsFormattedName) {
             console.warn(`Could not find data in processedData for selected PS: ${selectedPsFormattedName}`);
             // Optionally alert the user or show a message
        }
        // Deselect old list item if dropdown is used
        const previouslySelectedOld = psList.querySelector('.selected');
        if (previouslySelectedOld) {
             previouslySelectedOld.classList.remove('selected');
        }
    }


    // --- Candidate Display Logic ---
    function updateCandidateColumnsUI(candidates) {
        clearCandidateColumnsUI();
        const populateList = (listElement, candidateArray) => {
            if (candidateArray && candidateArray.length > 0) {
                candidateArray.forEach(name => { listElement.insertAdjacentHTML('beforeend', `<li>${name}</li>`); });
            } else {
                listElement.insertAdjacentHTML('beforeend', `<li class="uncontested">Uncontested or Nil</li>`);
            }
        };
        populateList(zpcCandidateList, candidates?.zpc); // Use optional chaining
        populateList(apCandidateList, candidates?.ap);
        populateList(wardCandidateList, candidates?.ward);
    }

    function clearCandidateColumnsUI() {
        zpcCandidateList.innerHTML = '';
        apCandidateList.innerHTML = '';
        wardCandidateList.innerHTML = '';
    }

    /**
     * Exports the current data *visible* in the ballot table view to an Excel file.
     * (Unchanged)
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
                const processedIndex = parseInt(row.dataset.processedIndex, 10); // Use processedIndex
                 if (processedIndex >= 0 && processedIndex < processedData.length) {
                    const rowData = processedData[processedIndex];
                    visibleTotalBallots += rowData.ballotInfo.psTotal;
                    dataToExport.push({
                        [headers[0]]: visibleRowCount, [headers[1]]: rowData.psName, // Use formatted name
                        [headers[2]]: rowData.voters,
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
        dataToExport.push({}); // Add empty row for spacing
        dataToExport.push({ [headers[1]]: "Visible Rows Total", [headers[9]]: visibleTotalBallots });

        try {
            const ws = XLSX.utils.json_to_sheet(dataToExport, { header: headers });
            // Optional: Adjust column widths (example)
            // ws['!cols'] = [{wch:5}, {wch:40}, {wch:15}, {wch:10}, {wch:15}, {wch:10}, {wch:15}, {wch:10}, {wch:15}, {wch:15}];
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
        const hasData = processedData && processedData.length > 0;

        // Primary load actions
        loadFromUrlButton.disabled = loading;
        fileInput.disabled = loading;
        if (fileInputLabel) {
            fileInputLabel.classList.toggle('button-disabled', loading);
        }

        // Data-dependent actions
        exportButton.disabled = loading || !hasData;
        ballotSearchInput.disabled = loading || !hasData;
        ballotSearchButton.disabled = loading || !hasData;

        // Old PS list controls (conditionally enabled)
        psSearchInput.disabled = loading || !hasData;

        // New dropdown controls (conditionally enabled based on data and selection)
        zpcSelect.disabled = loading || !hasData || !hierarchy.size;
        // Subsequent dropdowns are enabled/disabled by their respective handlers
        if (loading || !hasData) {
            resetAllDropdowns(); // Reset dropdowns if loading or no data
        }

        // Clear search fields if disabling
        if (loading || !hasData) {
            ballotSearchInput.value = '';
            psSearchInput.value = ''; // Clear old search input
             filterBallotTable();
             filterPsList(); // Clear old list filter
        }
    }

    function resetApplicationState(clearStatus = true) {
         rawData = [];
         processedData = [];
         psNames = [];
         psNameToIndexMap = {};
         totalAllBallots = 0;
         hierarchy.clear();
         headerMap = {};
         psNameToProcessedIndexMap.clear();

         resetUIOnly(); // Clears tables, resets dropdowns, clears candidate cols
         ballotSummaryLabel.textContent = 'Load data to see totals.';
         googleSheetUrlInput.value = '';
         ballotSearchInput.value = '';
         psSearchInput.value = ''; // Clear old search input

         if (clearStatus) {
            statusLabel.textContent = 'No data loaded.';
         }

         setControlsState(isLoading);
     }


    // --- Initial Setup ---
    setControlsState(false); // Initial state: not loading, no data
    document.title = 'Ballot Paper Requirements'; // Default title

}); // End DOMContentLoaded