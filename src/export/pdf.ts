// Exportación del cuadrante a PDF (horizontal, una página por semana/mes).

import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { BusinessConfig, ISODate } from '../engine/types'
import { buildSheets, DISCLAIMER, fileName, legend } from './table'

const rgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) || 255) as [number, number, number]
}

export function exportPdf(config: BusinessConfig, from: ISODate, to: ISODate, yearly: boolean) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const sheets = buildSheets(config, from, to, yearly)
  sheets.forEach((sheet, idx) => {
    if (idx > 0) doc.addPage()
    doc.setFontSize(13)
    doc.text(`${config.name} — ${sheet.title}`, 10, 12)
    const many = sheet.dates.length > 10
    const body = [
      ...sheet.rows.map((r) => [r.team, r.name, ...r.cells.map((c) => c.code)]),
      ...sheet.coverage.map((c) => ['Cobertura', c.label, ...c.values.map(String)]),
    ]
    autoTable(doc, {
      startY: 16,
      head: [['Equipo', 'Persona', ...sheet.headers.map((h) => (many ? h.replace(' ', '\n') : h))]],
      body,
      theme: 'grid',
      styles: { fontSize: many ? 6 : 9, cellPadding: many ? 0.8 : 1.5, halign: 'center', lineColor: [226, 232, 240] },
      headStyles: { fillColor: [79, 70, 229], textColor: 255 },
      columnStyles: { 0: { halign: 'left', cellWidth: many ? 16 : 24 }, 1: { halign: 'left', cellWidth: many ? 26 : 40 } },
      didParseCell: (data) => {
        if (data.column.index < 2) return
        const i = data.column.index - 2
        if (data.section === 'head' && sheet.holidays[i]) data.cell.styles.fillColor = [225, 29, 72]
        if (data.section !== 'body') return
        if (data.row.index < sheet.rows.length) {
          const cell = sheet.rows[data.row.index].cells[i]
          data.cell.styles.fillColor = rgb(cell.color)
          if (cell.changed) {
            data.cell.styles.fontStyle = 'bold'
            data.cell.styles.textColor = [190, 18, 60]
          }
        } else {
          const cov = sheet.coverage[data.row.index - sheet.rows.length]
          if (!cov.ok[i]) {
            data.cell.styles.textColor = [220, 38, 38]
            data.cell.styles.fontStyle = 'bold'
          }
        }
      },
    })
    const y = doc.internal.pageSize.getHeight() - 12
    doc.setFontSize(7)
    doc.setTextColor(60)
    doc.text(legend(config) + '   ·   En rojo: cambios manuales', 10, y - 4)
    doc.setTextColor(110)
    doc.text(doc.splitTextToSize(DISCLAIMER, 277), 10, y)
    doc.setTextColor(0)
  })
  doc.save(fileName(config, from, to, 'pdf'))
}
