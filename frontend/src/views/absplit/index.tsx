import { useCallback, useEffect, useMemo, useState } from 'react'

import { request } from '@/api/client'

const ENDPOINT = '/api/absplit'
const columns = [
  "分流记录编号",
  "关联实验",
  "变体编号",
  "来源标识",
  "分流占比",
  "指标窗口",
  "指标组合",
]
const statuses = ["待核对", "已入表"]

type Row = Record<string, string | number | null>

export default function AbsplitView() {
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const filterFields = useMemo(() => ["分流记录编号", "关联实验", "status"], [])

  const reload = useCallback(async () => {
    setErrorMessage('')
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value)
    ).toString()
    try {
      const response = await request(`${ENDPOINT}?${query}`)
      if (!response.ok) {
        throw new Error('变体分流记录列表读取失败')
      }
      const payload = await response.json()
      setRows(payload.items ?? [])
      setTotal(payload.total ?? 0)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '变体分流记录读取失败')
    }
  }, [filters])

  useEffect(() => {
    void reload()
  }, [reload])

  const pendingCount = rows.filter((row) => row.status === '待核对').length
  const enteredCount = rows.filter((row) => row.status === '已入表').length

  return (
    <section className="page" data-module="absplit">
      <header className="page-head">
        <div>
          <h2>变体分流记录（新增入口）</h2>
          <p className="page-desc">
            接收新增模块推送的变体分流记录，是实验看板指标明细数据集的唯一数据入口；已入表记录随已落定数据集核对。
          </p>
        </div>
        <div className="page-actions">
          <button className="btn" type="button" onClick={() => window.open(`${ENDPOINT}/export`, '_blank')}>
            导出分流记录
          </button>
        </div>
      </header>

      <div className="stat-row">
        <article className="stat-card">
          <span className="stat-label">分流记录总数（当前页）</span>
          <strong className="stat-value">{rows.length}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">待核对</span>
          <strong className="stat-value">{pendingCount}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">已入表（被已落定数据集采用）</span>
          <strong className="stat-value">{enteredCount}</strong>
        </article>
      </div>

      <form className="filter-bar" onSubmit={(event) => { event.preventDefault(); void reload() }}>
        {filterFields.map((field) => (
          <label key={field} className="filter-item">
            <span>{field === 'status' ? '状态' : field}</span>
            {field === 'status' ? (
              <select
                value={filters[field] ?? ''}
                onChange={(event) => setFilters((prev) => ({ ...prev, [field]: event.target.value }))}
              >
                <option value="">全部</option>
                {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            ) : (
              <input
                value={filters[field] ?? ''}
                placeholder={`按${field}检索`}
                onChange={(event) => setFilters((prev) => ({ ...prev, [field]: event.target.value }))}
              />
            )}
          </label>
        ))}
        <button className="btn" type="submit">查询</button>
        <button className="btn ghost" type="button" onClick={() => setFilters({})}>重置条件</button>
      </form>

      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => <th key={column}>{column}</th>)}
            <th>核对状态</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.id)}>
              {columns.map((column) => <td key={column}>{row[column] ?? '—'}</td>)}
              <td>{row.status ?? '—'}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="empty-state" colSpan={columns.length + 1}>暂无变体分流记录</td>
            </tr>
          )}
        </tbody>
      </table>

      <footer className="page-foot">
        <span>共 {total} 条变体分流记录</span>
        {errorMessage && <span className="error-text">{errorMessage}</span>}
      </footer>
    </section>
  )
}
