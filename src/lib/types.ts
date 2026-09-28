export type Role = "admin" | "staff" | "board_member";

export type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  is_active: boolean;
  created_at: string;
};

export type Meeting = {
  id: string;
  title: string;
  meeting_date: string; // ISO date
  created_by: string;
  created_at: string;
};

export type DocumentRow = {
  id: string;
  meeting_id: string;
  title: string;
  file_path: string;
  file_type: string; // 'pdf' | 'image' | 'office'
  uploaded_by: string;
  created_at: string;
};

export type DocumentView = {
  id: string;
  document_id: string;
  user_id: string;
  first_viewed_at: string;
  last_viewed_at: string;
  view_count: number;
};

export type Comment = {
  id: string;
  document_id: string;
  user_id: string;
  page_number: number | null;
  x: number | null;
  y: number | null;
  body: string;
  parent_id: string | null;
  created_at: string;
};

export function classifyFileType(filename: string): "pdf" | "image" | "office" {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "image";
  return "office";
}
