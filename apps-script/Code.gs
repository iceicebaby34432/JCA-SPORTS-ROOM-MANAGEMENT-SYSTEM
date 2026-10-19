/**
 * Sports Room – Google Apps Script Backend (permanent database)
 * ----------------------------------------------------------------
 * SETUP:
 * 1. Create a blank Google Sheet (name it e.g. SportsRoom_DB)
 * 2. Extensions → Apps Script → paste this entire file → Save
 * 3. Deploy → New deployment → Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copy the Web App URL into the website Settings panel
 *
 * Sheets are created automatically: Equipment | Loans | Users
 * No sample data is loaded — add your own inventory and accounts.
 */

const SHEET_NAMES = {
  equipment: 'Equipment',
  loans: 'Loans',
  users: 'Users',
};

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({
      status: 'Sports Room API is running',
      version: '2.0',
      database: 'Google Sheets',
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    let result;

    switch (action) {
      case 'getAll':
        result = getAll();
        break;
      case 'syncAll':
        result = syncAll(data);
        break;
      case 'addEquipment':
        result = addEquipment(data);
        break;
      case 'updateEquipment':
        result = updateEquipment(data);
        break;
      case 'deleteEquipment':
        result = deleteEquipment(data.id);
        break;
      case 'addLoan':
        result = addLoan(data);
        break;
      case 'returnLoan':
        result = returnLoan(data.id, data.actualReturn);
        break;
      case 'addUser':
        result = addUser(data);
        break;
      case 'login':
        result = loginUser(data.username, data.password);
        break;
      default:
        result = { success: false, error: 'Unknown action: ' + action };
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: String(err.message || err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getOrCreateSheet(name, headers) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function ensureSheets() {
  getOrCreateSheet(SHEET_NAMES.equipment, [
    'id', 'name', 'category', 'quantity', 'available', 'status', 'description',
  ]);
  getOrCreateSheet(SHEET_NAMES.loans, [
    'id', 'equipmentId', 'userId', 'borrowDate', 'returnDate', 'actualReturn', 'status',
  ]);
  getOrCreateSheet(SHEET_NAMES.users, [
    'id', 'fullName', 'username', 'password', 'role',
  ]);
}

function sheetToObjects(sheet) {
  const range = sheet.getDataRange();
  const data = range.getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).filter(function (row) {
    return row[0] !== '' && row[0] !== null && row[0] !== undefined;
  }).map(function (row) {
    const obj = {};
    headers.forEach(function (h, i) {
      obj[h] = row[i];
    });
    if (obj.quantity !== undefined) obj.quantity = Number(obj.quantity) || 0;
    if (obj.available !== undefined) obj.available = Number(obj.available) || 0;
    return obj;
  });
}

function objectsToSheet(sheet, objects, headers) {
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  if (!objects || objects.length === 0) return;
  const rows = objects.map(function (obj) {
    return headers.map(function (h) {
      return obj[h] !== undefined && obj[h] !== null ? obj[h] : '';
    });
  });
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

/** Load all data — empty sheets return empty arrays (no sample data) */
function getAll() {
  ensureSheets();
  const ss = getSpreadsheet();
  return {
    success: true,
    data: {
      equipment: sheetToObjects(ss.getSheetByName(SHEET_NAMES.equipment)),
      loans: sheetToObjects(ss.getSheetByName(SHEET_NAMES.loans)),
      users: sheetToObjects(ss.getSheetByName(SHEET_NAMES.users)),
    },
  };
}

function syncAll(payload) {
  ensureSheets();
  const ss = getSpreadsheet();

  if (payload.equipment) {
    objectsToSheet(
      ss.getSheetByName(SHEET_NAMES.equipment),
      payload.equipment,
      ['id', 'name', 'category', 'quantity', 'available', 'status', 'description']
    );
  }
  if (payload.loans) {
    objectsToSheet(
      ss.getSheetByName(SHEET_NAMES.loans),
      payload.loans,
      ['id', 'equipmentId', 'userId', 'borrowDate', 'returnDate', 'actualReturn', 'status']
    );
  }
  if (payload.users) {
    objectsToSheet(
      ss.getSheetByName(SHEET_NAMES.users),
      payload.users,
      ['id', 'fullName', 'username', 'password', 'role']
    );
  }
  return { success: true, message: 'Synced' };
}

function addEquipment(data) {
  ensureSheets();
  const sheet = getSpreadsheet().getSheetByName(SHEET_NAMES.equipment);
  const items = sheetToObjects(sheet);
  const id = data.id || ('EQ' + Date.now().toString(36).toUpperCase());
  items.push({
    id: id,
    name: data.name,
    category: data.category || 'Other',
    quantity: Number(data.quantity) || 1,
    available: Number(data.quantity) || 1,
    status: 'available',
    description: data.description || '',
  });
  objectsToSheet(sheet, items, ['id', 'name', 'category', 'quantity', 'available', 'status', 'description']);
  return { success: true, id: id };
}

function updateEquipment(data) {
  ensureSheets();
  const sheet = getSpreadsheet().getSheetByName(SHEET_NAMES.equipment);
  const items = sheetToObjects(sheet);
  const idx = items.findIndex(function (i) { return i.id === data.id; });
  if (idx === -1) return { success: false, error: 'Not found' };
  items[idx] = Object.assign({}, items[idx], data);
  objectsToSheet(sheet, items, ['id', 'name', 'category', 'quantity', 'available', 'status', 'description']);
  return { success: true };
}

function deleteEquipment(id) {
  ensureSheets();
  const sheet = getSpreadsheet().getSheetByName(SHEET_NAMES.equipment);
  var items = sheetToObjects(sheet).filter(function (i) { return i.id !== id; });
  objectsToSheet(sheet, items, ['id', 'name', 'category', 'quantity', 'available', 'status', 'description']);
  return { success: true };
}

function addLoan(data) {
  ensureSheets();
  const sheet = getSpreadsheet().getSheetByName(SHEET_NAMES.loans);
  const loans = sheetToObjects(sheet);
  const id = data.id || ('L' + Date.now().toString(36).toUpperCase());
  loans.push({
    id: id,
    equipmentId: data.equipmentId,
    userId: data.userId,
    borrowDate: data.borrowDate,
    returnDate: data.returnDate,
    actualReturn: '',
    status: 'borrowed',
  });
  objectsToSheet(sheet, loans, ['id', 'equipmentId', 'userId', 'borrowDate', 'returnDate', 'actualReturn', 'status']);
  return { success: true, id: id };
}

function returnLoan(id, actualReturn) {
  ensureSheets();
  const sheet = getSpreadsheet().getSheetByName(SHEET_NAMES.loans);
  const loans = sheetToObjects(sheet);
  const idx = loans.findIndex(function (l) { return l.id === id; });
  if (idx === -1) return { success: false, error: 'Loan not found' };
  loans[idx].status = 'returned';
  loans[idx].actualReturn = actualReturn || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  objectsToSheet(sheet, loans, ['id', 'equipmentId', 'userId', 'borrowDate', 'returnDate', 'actualReturn', 'status']);
  return { success: true };
}

function addUser(data) {
  ensureSheets();
  const sheet = getSpreadsheet().getSheetByName(SHEET_NAMES.users);
  const users = sheetToObjects(sheet);
  if (users.some(function (u) {
    return String(u.username).toLowerCase() === String(data.username).toLowerCase();
  })) {
    return { success: false, error: 'Username already exists' };
  }
  const id = data.id || ('U' + Date.now().toString(36).toUpperCase());
  users.push({
    id: id,
    fullName: data.fullName,
    username: data.username,
    password: data.password,
    role: data.role || 'borrower',
  });
  objectsToSheet(sheet, users, ['id', 'fullName', 'username', 'password', 'role']);
  return { success: true, id: id };
}

function loginUser(username, password) {
  ensureSheets();
  const users = sheetToObjects(getSpreadsheet().getSheetByName(SHEET_NAMES.users));
  const user = users.find(function (u) {
    return String(u.username).toLowerCase() === String(username).toLowerCase() &&
      String(u.password) === String(password);
  });
  if (!user) return { success: false, error: 'Invalid credentials' };
  return {
    success: true,
    user: {
      id: user.id,
      fullName: user.fullName,
      username: user.username,
      role: user.role,
    },
  };
}
