// Exportación del cuadrante a Excel (.xlsx) con colores.

import ExcelJS from 'exceljs'
import type { BusinessConfig, ISODate } from '../engine/types'
import { download } from './download'
import { buildSheets, DISCLAIMER, fileName, legend } from './table'

const argb = (hex: string) => 'FF' + hex.replace('#', '').toUpperCase().padEnd(6, 'F').slice(0, 6)

export async function exportExcel(config: BusinessConfig, from: ISODate, to: ISODate, yearly: boolean) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Cuadrante de turnos'
  for (const sheet of buildSheets(config, from, to, yearly)) {
    const ws = wb.addWorksheet(sheet.title.slice(0, 31).replace(/[/\\?*[\]:]/g, '-'))
    ws.addRow([`${config.name} — ${sheet.title}`]).font = { bold: true, size: 14 }
    ws.addRow([])
    const header = ws.addRow(['Equipo', 'Persona', ...sheet.headers])
    header.font = { bold: true }
    header.eachCell((cell, col) => {
      cell.alignment = { horizontal: 'center' }
      if (col > 2 && sheet.holidays[col - 3]) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFECDD3' } }
    })
    for (const r of sheet.rows) {
      const row = ws.addRow([r.team, r.name, ...r.cells.map((c) => c.code)])
      r.cells.forEach((c, i) => {
        const cell = row.getCell(i + 3)
        cell.alignment = { horizontal: 'center' }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(c.color) } }
        cell.border = c.changed
          ? { top: { style: 'medium', color: { argb: 'FFE11D48' } }, bottom: { style: 'medium', color: { argb: 'FFE11D48' } }, left: { style: 'medium', color: { argb: 'FFE11D48' } }, right: { style: 'medium', color: { argb: 'FFE11D48' } } }
          : { top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }, left: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } } }
      })
    }
    ws.addRow([])
    for (const c of sheet.coverage) {
      const row = ws.addRow(['Cobertura', c.label, ...c.values])
      row.font = { italic: true }
      c.ok.forEach((ok, i) => {
        const cell = row.getCell(i + 3)
        cell.alignment = { horizontal: 'center' }
        if (!ok) cell.font = { bold: true, color: { argb: 'FFDC2626' } }
      })
    }
    ws.addRow([])
    ws.addRow([legend(config)])
    ws.addRow(['Las casillas con borde rojo son cambios manuales sobre el patrón.'])
    ws.addRow([DISCLAIMER]).font = { italic: true, color: { argb: 'FF64748B' } }
    ws.getColumn(1).width = 12
    ws.getColumn(2).width = 22
    for (let i = 3; i < sheet.dates.length + 3; i++) ws.getColumn(i).width = 6
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 3 }]
  }
  const buffer = await wb.xlsx.writeBuffer()
  download(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    fileName(config, from, to, 'xlsx'),
  )
}
