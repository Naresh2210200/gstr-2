'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Upload, Download, FileSpreadsheet, CheckCircle, AlertCircle, FolderOpen, X, ChevronDown, ChevronUp } from 'lucide-react';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

const GSTRConverter = () => {
  const [files, setFiles] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [results, setResults] = useState([]);
  const [overallStats, setOverallStats] = useState(null);
  const [expandedFile, setExpandedFile] = useState(null);

  const parseExcelDate = (value) => {
    if (!value) return '';
    if (typeof value === 'string' && value.match(/^\d{2}-\d{2}-\d{4}$/)) return value;
    if (typeof value === 'number') {
      const date = new Date((value - 25569) * 86400 * 1000);
      return `${String(date.getDate()).padStart(2,'0')}-${String(date.getMonth()+1).padStart(2,'0')}-${date.getFullYear()}`;
    }
    return value;
  };

  const formatNumber = (value) => {
    if (!value && value !== 0) return '';
    const num = parseFloat(value);
    return isNaN(num) ? '' : num.toFixed(2);
  };

  const processSheet = (sheet, sheetName) => {
    const statedRange = XLSX.utils.decode_range(sheet['!ref']);
    let actualLastRow = statedRange.e.r;
    for (let r = statedRange.e.r + 1; r <= 200; r++) {
      let hasData = false;
      for (let c = 0; c <= 25; c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (cell && (cell.v !== undefined || cell.w !== undefined)) { hasData = true; actualLastRow = Math.max(actualLastRow, r); break; }
      }
      if (!hasData && r > actualLastRow + 5) break;
    }
    const range = { s: statedRange.s, e: { r: actualLastRow, c: statedRange.e.c } };

    let headerRow1 = -1;
    for (let r = 0; r <= Math.min(20, range.e.r); r++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c: 0 })];
      let v = '';
      if (cell) v = (cell.w || (cell.v !== undefined ? String(cell.v) : '') || '').trim();
      if (v.toLowerCase().includes('gstin of supplier')) { headerRow1 = r; break; }
    }
    if (headerRow1 === -1) return [];

    const headers = [];
    for (let c = 0; c <= range.e.c; c++) {
      const c1 = sheet[XLSX.utils.encode_cell({ r: headerRow1, c })];
      const c2 = sheet[XLSX.utils.encode_cell({ r: headerRow1 + 1, c })];
      const v1 = c1 ? (c1.w || (c1.v !== undefined ? String(c1.v) : '') || '').trim() : '';
      const v2 = c2 ? (c2.w || (c2.v !== undefined ? String(c2.v) : '') || '').trim() : '';
      headers.push(v2 || v1 || '');
    }

    const findCol = (terms) => {
      if (!Array.isArray(terms)) terms = [terms];
      for (const t of terms) {
        const idx = headers.findIndex(h => h && h.toLowerCase().includes(t.toLowerCase()));
        if (idx >= 0) return idx;
      }
      return -1;
    };

    const cols = {
      gstin: findCol(['GSTIN of supplier', 'GSTIN']),
      tradeName: findCol(['Trade/Legal name', 'Trade name']),
      invoiceNumber: findCol(['Invoice number', 'Note number']),
      invoiceDate: findCol(['Invoice Date', 'Note date']),
      rate: findCol(['Rate (%)', 'Rate']),
      taxableValue: findCol(['Taxable Value']),
      stateTax: findCol(['State/UT tax']),
      centralTax: findCol(['Central Tax']),
      integratedTax: findCol(['Integrated Tax']),
      invoiceValue: findCol(['Invoice Value', 'Note Value'])
    };

    const convertedData = [];
    for (let r = headerRow1 + 2; r <= range.e.r; r++) {
      const row = [];
      let hasData = false;
      for (let c = 0; c <= range.e.c; c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        let value = '';
        if (cell) value = (cell.w !== undefined ? String(cell.w) : (cell.v !== undefined ? String(cell.v) : '')).trim();
        row.push(value);
        if (value) hasData = true;
      }
      if (!hasData) continue;
      const gstinVal = cols.gstin >= 0 ? String(row[cols.gstin] || '').trim() : '';
      const invVal = cols.invoiceNumber >= 0 ? String(row[cols.invoiceNumber] || '').trim() : '';
      if (!gstinVal && !invVal) continue;
      convertedData.push({
        'SUPPLIER INV NO': invVal,
        'INVOICE DATE': cols.invoiceDate >= 0 ? parseExcelDate(row[cols.invoiceDate]) : '',
        'GST NO': gstinVal,
        'PARTY A/C NAME': cols.tradeName >= 0 ? String(row[cols.tradeName] || '').trim() : '',
        'PLACE OF SUPPLY': '',
        'Rate (%)': cols.rate >= 0 ? String(row[cols.rate] || '').trim() : '',
        'Taxable Value (₹)': cols.taxableValue >= 0 ? formatNumber(row[cols.taxableValue]) : '',
        'SGST': cols.stateTax >= 0 ? formatNumber(row[cols.stateTax]) : '',
        'CGST': cols.centralTax >= 0 ? formatNumber(row[cols.centralTax]) : '',
        'IGST': cols.integratedTax >= 0 ? formatNumber(row[cols.integratedTax]) : '',
        'TOTAL AMOUNT': cols.invoiceValue >= 0 ? formatNumber(row[cols.invoiceValue]) : '',
        'VOUCHER NO': invVal,
        'ROUND': '',
        'SOURCE': sheetName
      });
    }
    return convertedData;
  };

  const processSingleFile = async (file) => {
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const skip = ['READ ME', 'SUMMARY', 'README'];
      const b2b = workbook.SheetNames.find(n => n.toUpperCase() === 'B2B' && !skip.includes(n.toUpperCase()));
      const cdnr = workbook.SheetNames.find(n => n.toUpperCase() === 'CDNR' && !skip.includes(n.toUpperCase()));
      const b2bcdnr = workbook.SheetNames.find(n => (n.toUpperCase() === 'B2B-CDNR' || n.toUpperCase() === 'B2BCDNR') && !skip.includes(n.toUpperCase()));

      if (!b2b && !cdnr && !b2bcdnr) throw new Error('No B2B/CDNR sheets found');

      let allData = [];
      const sheetsProcessed = [];
      if (b2b) { const d = processSheet(workbook.Sheets[b2b], 'B2B'); allData = allData.concat(d); if (d.length) sheetsProcessed.push(`B2B (${d.length})`); }
      if (cdnr) { const d = processSheet(workbook.Sheets[cdnr], 'CDNR'); allData = allData.concat(d); if (d.length) sheetsProcessed.push(`CDNR (${d.length})`); }
      if (b2bcdnr) { const d = processSheet(workbook.Sheets[b2bcdnr], 'B2B-CDNR'); allData = allData.concat(d); if (d.length) sheetsProcessed.push(`B2B-CDNR (${d.length})`); }

      if (allData.length === 0) throw new Error('No valid data found');

      return {
        fileName: file.name,
        baseName: file.name.replace(/\.[^/.]+$/, ''),
        status: 'success', allData, sheetsProcessed,
        records: allData.length,
        totalTaxable: allData.reduce((s, r) => s + (parseFloat(r['Taxable Value (₹)']) || 0), 0),
        totalAmount: allData.reduce((s, r) => s + (parseFloat(r['TOTAL AMOUNT']) || 0), 0),
      };
    } catch (err) {
      return { fileName: file.name, baseName: file.name.replace(/\.[^/.]+$/, ''), status: 'error', error: err.message, records: 0 };
    }
  };

  const buildWorkbookBuffer = (result) => {
    const wb = XLSX.utils.book_new();
    ['B2B', 'B2B-CDNR', 'CDNR'].forEach(src => {
      const rows = result.allData.filter(r => r.SOURCE === src).map(({ SOURCE, ...rest }) => rest);
      if (rows.length) {
        const ws = XLSX.utils.json_to_sheet(rows);
        ws['!cols'] = Array(14).fill({ wch: 15 });
        XLSX.utils.book_append_sheet(wb, ws, src);
      }
    });
    // Return as array buffer
    return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  };

  const handleFilesUpload = async (e) => {
    const uploadedFiles = Array.from(e.target.files).filter(f => f.name.match(/\.(xlsx|xls)$/i));
    if (!uploadedFiles.length) return;
    setFiles(uploadedFiles);
    setResults([]);
    setOverallStats(null);
    setProcessing(true);

    const allResults = [];
    for (let i = 0; i < uploadedFiles.length; i++) {
      const res = await processSingleFile(uploadedFiles[i]);
      allResults.push(res);
      setResults([...allResults]);
    }

    const successful = allResults.filter(r => r.status === 'success');
    setOverallStats({
      total: allResults.length,
      success: successful.length,
      failed: allResults.filter(r => r.status === 'error').length,
      totalRecords: successful.reduce((s, r) => s + r.records, 0),
      totalAmount: successful.reduce((s, r) => s + r.totalAmount, 0),
    });
    setProcessing(false);
  };

  // Download single file
  const downloadSingle = (result) => {
    const buf = buildWorkbookBuffer(result);
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${result.baseName}.xlsx`;
    link.click();
  };

  // Download ALL as one ZIP
  const downloadAllAsZip = async () => {
    setZipping(true);
    try {
      const zip = new JSZip();
      const successful = results.filter(r => r.status === 'success');

      for (const result of successful) {
        const buf = buildWorkbookBuffer(result);
        zip.file(`${result.baseName}.xlsx`, buf);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(zipBlob);
      link.download = `GSTR2A_Converted_${successful.length}_files.zip`;
      link.click();
    } catch (err) {
      alert('Error creating ZIP: ' + err.message);
    }
    setZipping(false);
  };

  const reset = () => { setFiles([]); setResults([]); setOverallStats(null); setExpandedFile(null); };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 p-6">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-3">
            <FileSpreadsheet className="w-10 h-10 text-blue-600" />
            <h1 className="text-4xl font-bold text-gray-800">GSTR-2A Bulk Converter</h1>
          </div>
          <p className="text-gray-600">Select 100–200 files → Convert all → Download as one ZIP → Extract to your folder</p>
        </div>

        {/* Upload */}
        {!results.length && !processing && (
          <div className="bg-white rounded-xl shadow-lg p-8 mb-6">
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center hover:border-blue-400 transition-colors">
              <FolderOpen className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-700 mb-2">Select Multiple GSTR-2A Files</h3>
              <p className="text-gray-500 mb-2">
                Hold <kbd className="bg-gray-100 px-2 py-1 rounded text-sm font-mono">Ctrl</kbd> or <kbd className="bg-gray-100 px-2 py-1 rounded text-sm font-mono">Shift</kbd> to select multiple files
              </p>
              <p className="text-sm text-gray-400 mb-6">Supports .xlsx / .xls — B2B, CDNR, B2B-CDNR sheets</p>
              <input type="file" accept=".xlsx,.xls" multiple onChange={handleFilesUpload} className="hidden" id="file-upload" />
              <label htmlFor="file-upload" className="inline-block bg-blue-600 text-white px-8 py-3 rounded-lg cursor-pointer hover:bg-blue-700 transition-colors text-lg font-semibold">
                📂 Choose Files
              </label>
            </div>
          </div>
        )}

        {/* Progress */}
        {processing && (
          <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="animate-spin w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full"></div>
              <p className="text-gray-700 font-semibold text-lg">Processing... {results.length} / {files.length} files</p>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-4 mb-1">
              <div className="bg-blue-600 h-4 rounded-full transition-all duration-300"
                style={{ width: `${files.length ? (results.length / files.length) * 100 : 0}%` }} />
            </div>
            <p className="text-sm text-gray-500">{Math.round(files.length ? (results.length / files.length) * 100 : 0)}% complete</p>
          </div>
        )}

        {/* Stats + ZIP Download */}
        {overallStats && (
          <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-6 h-6 text-green-600" />
                <h2 className="text-2xl font-bold text-gray-800">All Done!</h2>
              </div>
              <button onClick={reset} className="flex items-center gap-1 text-gray-400 hover:text-red-500 text-sm transition-colors">
                <X className="w-4 h-4" /> Start Over
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
              {[
                { label: 'Total Files', val: overallStats.total, color: 'blue' },
                { label: 'Successful', val: overallStats.success, color: 'green' },
                { label: 'Failed', val: overallStats.failed, color: 'red' },
                { label: 'Total Records', val: overallStats.totalRecords, color: 'purple' },
                { label: 'Total Amount', val: `₹${overallStats.totalAmount.toFixed(0)}`, color: 'indigo' },
              ].map(({ label, val, color }) => (
                <div key={label} className={`bg-${color}-50 rounded-lg p-4 text-center`}>
                  <p className="text-sm text-gray-600">{label}</p>
                  <p className={`text-2xl font-bold text-${color}-600`}>{val}</p>
                </div>
              ))}
            </div>

            {/* ZIP Download Box */}
            <div className="bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-300 rounded-xl p-6">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-green-800 mb-1">📦 Download All as ZIP</h3>
                  <p className="text-sm text-green-700">All <strong>{overallStats.success} converted files</strong> bundled into one ZIP.</p>
                  <p className="text-sm text-green-600 mt-1">Save the ZIP anywhere → Right-click → <strong>Extract All</strong> → Choose your folder ✅</p>
                </div>
                <button
                  onClick={downloadAllAsZip}
                  disabled={zipping}
                  className="flex items-center gap-2 bg-green-600 text-white px-8 py-4 rounded-xl hover:bg-green-700 transition-colors font-bold text-lg shadow-lg disabled:opacity-60 whitespace-nowrap"
                >
                  {zipping
                    ? <><div className="animate-spin w-5 h-5 border-3 border-white border-t-transparent rounded-full" /> Creating ZIP...</>
                    : <><Download className="w-6 h-6" /> Download ZIP ({overallStats.success} files)</>
                  }
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Per-file list */}
        {results.length > 0 && (
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h3 className="text-xl font-bold text-gray-800 mb-4">
              File Results ({results.length}{processing ? ` / ${files.length} processing...` : ' processed'})
            </h3>
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {results.map((r, idx) => (
                <div key={idx} className={`border rounded-lg ${r.status === 'success' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  <div className="flex items-center justify-between p-3 cursor-pointer" onClick={() => setExpandedFile(expandedFile === idx ? null : idx)}>
                    <div className="flex items-center gap-2 min-w-0">
                      {r.status === 'success'
                        ? <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                        : <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />}
                      <span className="text-sm font-medium text-gray-800 truncate">{r.fileName}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                      {r.status === 'success' && (
                        <>
                          <span className="text-xs text-gray-500">{r.records} records</span>
                          <button onClick={(e) => { e.stopPropagation(); downloadSingle(r); }}
                            className="flex items-center gap-1 bg-blue-600 text-white px-2 py-1 rounded text-xs hover:bg-blue-700">
                            <Download className="w-3 h-3" /> Save
                          </button>
                        </>
                      )}
                      {r.status === 'error' && <span className="text-xs text-red-500">Failed</span>}
                      {expandedFile === idx ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                    </div>
                  </div>
                  {expandedFile === idx && (
                    <div className="px-4 pb-3 border-t border-gray-200 pt-2 text-sm">
                      {r.status === 'success' ? (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          <div><span className="text-gray-500">Sheets: </span><span className="font-medium">{r.sheetsProcessed.join(', ')}</span></div>
                          <div><span className="text-gray-500">Records: </span><span className="font-medium">{r.records}</span></div>
                          <div><span className="text-gray-500">Taxable: </span><span className="font-medium">₹{r.totalTaxable.toFixed(2)}</span></div>
                          <div><span className="text-gray-500">Total: </span><span className="font-medium">₹{r.totalAmount.toFixed(2)}</span></div>
                        </div>
                      ) : <p className="text-red-600">Error: {r.error}</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default GSTRConverter;
