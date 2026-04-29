const TENANT_CODE = import.meta.env.VITE_TENANT_CODE as string
const UPLOAD_URL = import.meta.env.VITE_ASSET_UPLOAD_URL as string

export interface AssetUploadResult {
  url: string
  key: string
  contentType: string
  sizeBytes: number
  fileName: string
  tenantCode: string
}

interface ApiEnvelope<T> {
  st: boolean
  msg: string | null
  data: T | null
}

// Uploads a single file to the external asset service. See TASK_MANAGEMENT_MVP.md §5 / §13.4.
// Never set Content-Type manually — the browser must add the multipart boundary.
export async function uploadAsset(file: File): Promise<AssetUploadResult> {
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: {
      accept: '*/*',
      x_tenant_code: TENANT_CODE,
    },
    body: formData,
  })

  if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status}`)

  const json = (await res.json()) as ApiEnvelope<AssetUploadResult>
  if (!json.st || !json.data) throw new Error(json.msg || 'Upload failed')
  return json.data
}