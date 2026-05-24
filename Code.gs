/**
 * GitHub Repo: https://github.com/AKRA-WEB/KPITRACKER
 */
const SPREADSHEET_ID = "1kP05ND3giKBHhsRYENyZl8mX5NHUID4U33eNxisd-JU";

function doPost(e) {
  // เปิดอนุญาต CORS (Cross-Origin Resource Sharing)
  var headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action || "saveData"; // รับค่า action (ถ้าไม่มีให้ถือว่าเป็นการบันทึกข้อมูลปกติ)

    // ==========================================
    // 1. สำหรับ Admin: บันทึกการตั้งค่าพนักงานใหม่
    // ==========================================
    if (action === "saveConfig") {
      var sheetName = "CONFIG_EMPLOYEES";
      var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(sheetName);
      if (!sheet) sheet = SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet(sheetName);
      
      sheet.clear(); // ล้างข้อมูลเก่าออกทั้งหมด
      // สร้าง Header
      sheet.appendRow(["UserID/EnglishName", "ชื่อพนักงาน(ไทย)", "สาขาที่เข้าได้ (คั่นด้วยลูกน้ำ)", "แผนก (สำหรับ TRD)"]);
      
      var configData = data.configData || [];
      configData.forEach(row => {
        sheet.appendRow([row.uid, row.name, row.branches, row.dept]);
      });
      
      return ContentService.createTextOutput(JSON.stringify({"status": "success"}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ==========================================
    // 2. สำหรับพนักงาน: บันทึกข้อมูล KPI ปกติ
    // ==========================================
    var branch = data.branch || "AKRA"; 
    var sheetName = "KPITRACKER_" + branch;
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(sheetName);
    
    if (!sheet) {
      sheet = SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet(sheetName);
      sheet.appendRow(["Date", "Errors", "Transfer", "Pickup", "Upcountry", "InMarket", "OutMarket", "Customer Notes", "Tasks"]);
    }

    var errorsText = (data.errors || []).map(err => `${err.emp} | ${err.type} | ${err.note}`).join("\n");
    var tasksText = (data.tasks || []).map(task => `${task.taskName} | ${task.status} | ${task.assignee || ""}`).join("\n");
    
    sheet.appendRow([
      data.date,
      errorsText,
      data.volume ? data.volume.transfer : 0,
      data.volume ? data.volume.pickup : 0,
      data.volume ? data.volume.upcountry : 0,
      data.volume ? data.volume.inmarket : 0,
      data.volume ? data.volume.outmarket : 0,
      data.customerNotes || "",
      tasksText
    ]);
    
    return ContentService.createTextOutput(JSON.stringify({"status": "success"}))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({"status": "error", "message": error.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  try {
    var action = e.parameter.action || "getData";

    // ==========================================
    // 1. โหลดการตั้งค่าพนักงานและสิทธิ์ (ส่งไปให้แอป)
    // ==========================================
    if (action === "getConfig") {
      var sheetName = "CONFIG_EMPLOYEES";
      var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(sheetName);
      
      // ถ้ายังไม่มีชีต ให้สร้างและใส่ข้อมูลตัวอย่างเริ่มต้นให้
      if (!sheet) {
        sheet = SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet(sheetName);
        sheet.appendRow(["UserID/EnglishName", "ชื่อพนักงาน(ไทย)", "สาขาที่เข้าได้ (คั่นด้วยลูกน้ำ)", "แผนก (สำหรับ TRD)"]);
        // ข้อมูลตั้งต้นสำหรับให้แอดมินดูเป็นตัวอย่าง
        sheet.appendRow(["250013", "เฉิน", "AKRA,TRD", "Admin"]);
        sheet.appendRow(["250005", "ท็อป", "TRD", "หน้าร้าน/ในร้าน"]);
        sheet.appendRow(["250025", "พุช", "AKRA", ""]);
      }

      var data = sheet.getDataRange().getValues();
      var configList = [];
      
      for (var i = 1; i < data.length; i++) {
        var row = data[i];
        if (!row[0] && !row[1]) continue;
        configList.push({
          uid: (row[0] || "").toString().trim(),
          name: (row[1] || "").toString().trim(),
          branches: (row[2] || "").toString().trim(),
          dept: (row[3] || "").toString().trim()
        });
      }
      return ContentService.createTextOutput(JSON.stringify(configList)).setMimeType(ContentService.MimeType.JSON);
    }

    // ==========================================
    // 2. โหลดข้อมูล KPI ปกติ
    // ==========================================
    var branch = e.parameter.branch || "AKRA"; 
    var sheetName = "KPITRACKER_" + branch;
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(sheetName);
    if (!sheet) return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
    
    var data = sheet.getDataRange().getValues();
    var result = [];
    
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      
      var dateStr = (row[0] instanceof Date) ? Utilities.formatDate(row[0], "GMT+7", "yyyy-MM-dd") : row[0];

      // ตัดช่องว่างส่วนเกินทิ้งให้อัตโนมัติ ป้องกันปัญหาการแก้ข้อมูลใน Sheet
      var errorsArr = (row[1] || "").toString().split("\n").filter(l => l.includes("|")).map(line => {
        var p = line.split(/\s*\|\s*/);
        return { emp: p[0] ? p[0].trim() : "", type: p[1] ? p[1].trim() : "", note: p.slice(2).join(" | ").trim() };
      });

      var tasksArr = (row[8] || "").toString().split("\n").filter(l => l.includes("|")).map(line => {
        var p = line.split(/\s*\|\s*/);
        return { taskName: p[0] ? p[0].trim() : "", status: p[1] ? p[1].trim() : "", assignee: p[2] ? p[2].trim() : "" };
      });
      
      result.push({
        date: dateStr,
        errors: errorsArr,
        tasks: tasksArr,
        volume: { transfer: row[2] || 0, pickup: row[3] || 0, upcountry: row[4] || 0, inmarket: row[5] || 0, outmarket: row[6] || 0 },
        customerNotes: row[7] || ""
      });
    }
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
     return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
  }
}

// ฟังก์ชันรองรับการเรียกแบบ OPTIONS เพื่อแก้ปัญหาเบราว์เซอร์ร้องขอ Preflight (ป้องกัน Error Failed to fetch)
function doOptions(e) {
  var headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
  return ContentService.createTextOutput("")
    .setMimeType(ContentService.MimeType.TEXT)
    .setHeaders(headers);
}