/** Hợp đồng đọc-only cho file kế hoạch do sandbox cung cấp. */

export type PlanStatus = 'draft' | 'approved'

export interface PlanVersion {
  version: number
  label: string
  relativePath: string
  sizeBytes: number
  modifiedAt: string
  status: PlanStatus
  /**
   * Khối header đọc thẳng từ file (vòng 20, `plan_files.py::parse_plan_header`).
   * `ok` = file có `<!-- boxfox-plan`; `legacy` = file cũ chưa có; `mismatch` = header lệch tên file.
   * Chỉ `ok` mới có quyền nói cha–con (`declaredParent`) — file legacy không được đoán.
   */
  headerStatus?: 'ok' | 'legacy' | 'mismatch' | null
  headerVersion?: number | null
  headerIdentity?: string | null
  declaredParent?: number | null
  declaredSlug?: string | null
}

export interface PlanManifestEntry {
  identity: string
  relativeDirectory: string
  slug: string
  versions: PlanVersion[]
}

export interface PlanManifest {
  plans: PlanManifestEntry[]
  ignoredCount: number
  warnings: string[]
}

export interface PlanDocument extends PlanVersion {
  identity: string
  markdown: string
}

export interface PlanRepository {
  list(signal?: AbortSignal): Promise<PlanManifest>
  read(identity: string, version: number, signal?: AbortSignal): Promise<PlanDocument>
}

/** Status hiện chỉ là trình bày tạm thời, không phải metadata ghi xuống file. */
export function withPresentationStatuses(manifest: PlanManifest): PlanManifest {
  return {
    ...manifest,
    plans: manifest.plans.map((plan) => ({
      ...plan,
      versions: plan.versions.map((version, index) => ({
        ...version,
        status: plan.versions.length === 1 || index > 0 ? 'approved' : 'draft',
      })),
    })),
  }
}

/** Lựa chọn đang hiển thị; `null` biểu thị manifest không có plan hợp lệ. */
export interface PlanSelection {
  identity: string
  version: number
}

/**
 * Giữ nguyên phiên bản đang xem nếu nó còn tồn tại; nếu không, dùng bản mới
 * nhất của cùng plan. Khi plan mất, chuyển về plan đầu tiên theo manifest.
 */
export function reconcilePlanSelection(
  manifest: PlanManifest,
  selection: PlanSelection | null,
): PlanSelection | null {
  const fallback = manifest.plans[0]?.versions[0]
  if (!fallback) return null

  const currentPlan = selection
    ? manifest.plans.find((plan) => plan.identity === selection.identity)
    : undefined
  if (currentPlan) {
    const currentVersion = currentPlan.versions.find((item) => item.version === selection!.version)
    return {
      identity: currentPlan.identity,
      version: currentVersion?.version ?? currentPlan.versions[0]!.version,
    }
  }

  return {
    identity: manifest.plans[0]!.identity,
    version: fallback.version,
  }
}
