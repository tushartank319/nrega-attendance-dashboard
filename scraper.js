const puppeteer = require('puppeteer');

/**
 * Automates daily attendance retrieval down to Panchayat level.
 * @param {string} dateVal - Date formatted as "DD/MM/YYYY" (e.g. "20/06/2026")
 * @param {string} stateCode - State selection code (e.g. "07" for DN HAVELI AND DD)
 * @param {function} onProgress - Callback for real-time progress updates
 */
async function scrapeAttendance(dateVal, stateCode = '07', onProgress = () => {}) {
  let browser;
  try {
    onProgress({ step: 'init', message: 'Launching Chromium browser...' });
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    onProgress({ step: 'home', message: 'Opening NREGA Home Page...' });
    await page.goto('https://nrega.dord.gov.in/MGNREGA_new/Nrega_home.aspx', {
      waitUntil: 'networkidle2',
      timeout: 45000
    });

    onProgress({ step: 'finding_link', message: 'Clicking View Daily Attendance link...' });
    
    // Set up tab creation listener before clicking
    const newPagePromise = new Promise(resolve => 
      browser.once('targetcreated', target => resolve(target.page()))
    );

    // Wait for the daily attendance link (even if hidden in menu)
    await page.waitForSelector('a[href*="NMMS_DailyAttendance.aspx"]', { timeout: 15000 });
    
    // Click programmatically in page context
    const clicked = await page.evaluate(() => {
      const a = document.querySelector('a[href*="NMMS_DailyAttendance.aspx"]');
      if (a) {
        a.click();
        return true;
      }
      return false;
    });

    if (!clicked) {
      throw new Error('Daily Attendance link not found on NREGA home page DOM.');
    }

    // Get the handle for the newly opened attendance page tab
    const attendancePage = await newPagePromise;
    if (!attendancePage) {
      throw new Error('Failed to open Daily Attendance tab.');
    }
    
    await attendancePage.setViewport({ width: 1280, height: 800 });
    await attendancePage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    onProgress({ step: 'attendance_page', message: 'Accessing Daily Attendance page...' });
    // Wait for page to finish loading the initial select element
    await attendancePage.waitForSelector('#ctl00_ContentPlaceHolder1_ddlstate', { timeout: 30000 });

    // 1. Select State (causes postback)
    onProgress({ step: 'select_state', message: `Selecting State (Code: ${stateCode})...` });
    
    const stateExists = await attendancePage.evaluate((code) => {
      const select = document.getElementById('ctl00_ContentPlaceHolder1_ddlstate');
      return Array.from(select.options).some(opt => opt.value === code);
    }, stateCode);

    if (!stateExists) {
      throw new Error(`State code ${stateCode} is not available in the dropdown.`);
    }

    // Select state and wait for postback load
    await attendancePage.select('#ctl00_ContentPlaceHolder1_ddlstate', stateCode);
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 2. Select Date (causes postback)
    onProgress({ step: 'select_date', message: `Selecting Date: ${dateVal}...` });
    await attendancePage.waitForSelector('#ctl00_ContentPlaceHolder1_ddl_attendance', { timeout: 15000 });
    
    const dateExists = await attendancePage.evaluate((date) => {
      const select = document.getElementById('ctl00_ContentPlaceHolder1_ddl_attendance');
      return Array.from(select.options).some(opt => opt.value === date);
    }, dateVal);

    if (!dateExists) {
      const availableDates = await attendancePage.evaluate(() => {
        const select = document.getElementById('ctl00_ContentPlaceHolder1_ddl_attendance');
        return Array.from(select.options).map(opt => opt.value);
      });
      throw new Error(`Date ${dateVal} is not available. Available dates are: ${availableDates.join(', ')}`);
    }

    // Select date and wait for postback load
    await attendancePage.select('#ctl00_ContentPlaceHolder1_ddl_attendance', dateVal);
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 3. Click Show Report
    onProgress({ step: 'show_report', message: 'Submitting report request...' });
    await attendancePage.waitForSelector('#ctl00_ContentPlaceHolder1_btn_showreport', { timeout: 15000 });
    await Promise.all([
      attendancePage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
      attendancePage.click('#ctl00_ContentPlaceHolder1_btn_showreport')
    ]);
    await attendancePage.waitForSelector('table', { timeout: 20000 });

    // 4. State Level Table - Click State Name
    onProgress({ step: 'drill_state', message: 'Drilling down to State Level...' });
    await attendancePage.waitForSelector('table', { timeout: 20000 });

    const clickedState = await Promise.all([
      attendancePage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
      attendancePage.evaluate((code) => {
        const links = Array.from(document.querySelectorAll('a'));
        const stateLink = links.find(a => a.href && a.href.includes(`state_code=${code}`));
        if (stateLink) {
          stateLink.click();
          return true;
        }
        return false;
      }, stateCode)
    ]).then(results => results[1]);

    if (!clickedState) {
      throw new Error(`State link with code ${stateCode} not found in report table.`);
    }
    await attendancePage.waitForSelector('table', { timeout: 20000 });

    // 5. District Level Table - Click District Name
    onProgress({ step: 'drill_district', message: 'Drilling down to District Level...' });
    await attendancePage.waitForSelector('table', { timeout: 20000 });

    const clickedDistrict = await Promise.all([
      attendancePage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
      attendancePage.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        const distLink = links.find(a => a.href && a.href.includes('district_code='));
        if (distLink) {
          distLink.click();
          return true;
        }
        return false;
      })
    ]).then(results => results[1]);

    if (!clickedDistrict) {
      throw new Error('District link not found in report table.');
    }
    await attendancePage.waitForSelector('table', { timeout: 20000 });

    // 6. Block Level Table - Click Block Name
    onProgress({ step: 'drill_block', message: 'Drilling down to Block Level...' });
    await attendancePage.waitForSelector('table', { timeout: 20000 });

    const clickedBlock = await Promise.all([
      attendancePage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
      attendancePage.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        const blockLink = links.find(a => a.href && a.href.includes('block_code='));
        if (blockLink) {
          blockLink.click();
          return true;
        }
        return false;
      })
    ]).then(results => results[1]);

    if (!clickedBlock) {
      throw new Error('Block link not found in report table.');
    }
    await attendancePage.waitForSelector('table', { timeout: 20000 });

    // 7. Panchayat Level Table - Scrape Data
    onProgress({ step: 'scrape_panchayat', message: 'Scraping Panchayat attendance table...' });
    await attendancePage.waitForSelector('table', { timeout: 20000 });

    const rawData = await attendancePage.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table'));
      const mainTable = tables.find(t => t.id && t.id.includes('grd')) || 
                        tables.find(t => t.querySelector('th') || t.innerText.includes('Panchayat'));
      
      if (!mainTable) return null;

      const rows = Array.from(mainTable.querySelectorAll('tr'));
      return rows.map(tr => {
        const cells = Array.from(tr.querySelectorAll('td, th'));
        return cells.map(td => td.innerText.trim().replace(/\s+/g, ' '));
      }).filter(r => r.length > 0);
    });

    if (!rawData) {
      throw new Error('Could not find Panchayat data table in final page.');
    }

    onProgress({ step: 'parsing', message: 'Processing scraped data...' });
    const result = parsePanchayatTable(rawData);

    onProgress({ step: 'done', message: 'Scraping completed successfully!' });
    return result;

  } catch (error) {
    onProgress({ step: 'error', message: `Error: ${error.message}` });
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Parses raw table rows into a structured JSON format.
 */
function parsePanchayatTable(rows) {
  let headerIndex = -1;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    if (rows[i].some(cell => cell.toLowerCase().includes('panchayat') || cell.toLowerCase().includes('panchayat name'))) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    headerIndex = 0;
  }

  const headers = rows[headerIndex];
  const dataRows = [];
  let totals = null;

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 0 || row.every(c => c === '')) continue;

    if (row.some(cell => cell.toLowerCase().includes('total') || cell.toLowerCase().includes('grand total'))) {
      totals = row;
      continue;
    }

    const sNo = parseInt(row[0]);
    if (!isNaN(sNo) || row.length === headers.length) {
      dataRows.push(row);
    }
  }

  const formattedData = dataRows.map(row => {
    return {
      sNo: row[0] || '',
      panchayatName: row[1] || 'Unknown',
      worksites: row[2] || '0',
      musterRolls: row[3] || '0',
      registeredWorkers: row[4] || '0',
      presentWorkers: row[5] || '0',
      presentWorkersWithPhoto: row[6] || '0',
      persondays: row[7] || '0'
    };
  });

  let formattedTotals = null;
  if (totals) {
    formattedTotals = {
      panchayatName: 'TOTAL',
      worksites: totals[2] || '0',
      musterRolls: totals[3] || '0',
      registeredWorkers: totals[4] || '0',
      presentWorkers: totals[5] || '0',
      presentWorkersWithPhoto: totals[6] || '0',
      persondays: totals[7] || '0'
    };
  }

  return {
    headers: [
      'S.No.',
      'Panchayat Name',
      'No. of Worksites',
      'No. of Muster Rolls',
      'Registered Workers',
      'Present Workers',
      'Present Workers With Photo',
      'Persondays Generated'
    ],
    data: formattedData,
    totals: formattedTotals
  };
}

module.exports = {
  scrapeAttendance
};
