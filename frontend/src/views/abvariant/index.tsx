import { useCallback, useEffect, useMemo, useState } from 'react'

import { request } from '@/api/client'

const ENDPOINT = '/api/abvariant'
const columns = [
  "变体编号",
  "关联实验",
  "变体名称",
  "变体描述",
  "分流占比",
  "配置参数集",
  "指标期望",
  "生效时间范围"
]
const actions = [
  "提交变体审批",
  "生效变体",
  "下线变体"
]
const statuses = [
  "草稿",
  "变体审批中",
  "已生效",
  "已下线"
]

type Row = Record<string, string | number | null>
type MetricRow = {
  行类型: string
  关联实验: string
  变体编号: string
  变体状态: string
  分流占比: number
  指标组合?: Record<string, number>
  指标差异?: string[]
  告警线状态?: string
}
type Snapshot = {
  版本号: number | null
  批次号?: string
  发布时间?: string | null
  items?: MetricRow[]
}

export default function AbvariantView() {
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const filterFields = useMemo(() => ["变体编号", "关联实验", "status"], [])

  const reload = useCallback(async () => {
    setErrorMessage('')
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value)
    ).toString()
    try {
      const [listRes, snapshotRes] = await Promise.all([
        request(`${ENDPOINT}?${query}&size=200`),
        request('/api/dashboard/2/metrics'),
      ])
      if (!listRes.ok) {
        throw new Error('变体方案列表读取失败')
      }
      const payload = await listRes.json()
      setRows(payload.items ?? [])
      setTotal(payload.total ?? 0)
      if (snapshotRes.ok) {
        setSnapshot(await snapshotRes.json())
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '实验变体列表读取失败')
    }
  }, [filters])

  useEffect(() => {
    void reload()
  }, [reload])

  async function runAction(action: string, row: Row) {
    setErrorMessage('')
    try {
      const response = await request(`${ENDPOINT}/${row.id}/actions`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      })
      if (!response.ok) {
        throw new Error('实验变体动作未生效，请稍后重试')
      }
      const payload = await response.json()
      if (!payload.ok) {
        throw new Error(payload.message ?? '实验变体操作失败')
      }
      await reload()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '实验变体操作失败')
    }
  }

  const effectiveCount = rows.filter((row) => row.status === '已生效').length
  const reviewingCount = rows.filter((row) => row.status === '变体审批中').length
  const variantMetricMap = new Map<string, MetricRow>(
    (snapshot?.items ?? []).filter((item) => item.行类型 === '变体明细').map((item) => [item.变体编号, item])
  )

  return (
    <section className="page" data-module="abvariant">
      <header className="page-head">
        <div>
          <h2>实验变体管理</h2>
          <p className="page-desc">
            管理A/B实验的变体配置，定义每个变体的参数、分流比例和期望指标；只有已生效变体才能进入运营看板（DASH-0002）。
          </p>
        </div>
        <div className="page-actions">
          <button className="btn primary" type="button" onClick={() => setErrorMessage('变体方案登记入口尚未接入审批流')}>
            登记变体方案
          </button>
          <button className="btn" type="button" onClick={() => window.open(`${ENDPOINT}/export`, '_blank')}>
            导出实验变体清单
          </button>
        </div>
      </header>

      <div className="stat-row">
        <article className="stat-card">
          <span className="stat-label">变体方案总数（当前筛选）</span>
          <strong className="stat-value">{rows.length}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">已生效变体（可入看板）</span>
          <strong className="stat-value">{effectiveCount}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">审批中变体（未生效，不可入看板）</span>
          <strong className="stat-value">{reviewingCount}</strong>
        </article>
      </div>

      <form className="filter-bar" onSubmit={(event) => { event.preventDefault(); void reload() }}>
        {filterFields.map((field) => (
          <label key={field} className="filter-item">
            <span>{field === 'status' ? '变体状态' : field}</span>
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
            <th>变体状态</th>
            <th>DASH-0002 看板关联结果</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const linked = variantMetricMap.get(String(row.变体编号))
            return (
              <tr key={String(row.id)}>
                {columns.map((column) => <td key={column}>{row[column] ?? '—'}</td>)}
                <td>{row.status ?? '—'}</td>
                <td>
                  {linked ? (
                    <span>
                      已入看板 V{snapshot?.版本号}（分流占比 {linked.分流占比}）
                      {linked.指标差异?.map((item) => (
                        <span key={item} style={{ display: 'block' }}>{item}</span>
                      ))}
                    </span>
                  ) : row.status === '已生效' ? (
                    <span>已生效，等待下一版数据集发布</span>
                  ) : (
                    <span>未生效，不能进入当前看板</span>
                  )}
                </td>
                <td className="row-actions">
                  {actions.map((action) => (
                    <button key={action} className="link" type="button" onClick={() => void runAction(action, row)}>
                      {action}
                    </button>
                  ))}
                </td>
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr>
              <td className="empty-state" colSpan={columns.length + 3}>暂无实验变体数据，可先登记变体方案</td>
            </tr>
          )}
        </tbody>
      </table>

      <footer className="page-foot">
        <span>共 {total} 条实验变体记录</span>
        {errorMessage && <span className="error-text">{errorMessage}</span>}
      </footer>
    </section>
  )
}
