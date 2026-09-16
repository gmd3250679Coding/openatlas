import type { Employee } from '../services/api';

export type EmployeePhotoOption = {
  id: string;
  label: string;
  url: string;
};

export const EMPLOYEE_PHOTO_OPTIONS: EmployeePhotoOption[] = [
  { id: 'portrait-01', label: '蓝色商务顾问', url: '/employee-photos/employee-photo-1.png' },
  { id: 'portrait-02', label: '紫色运营专家', url: '/employee-photos/employee-photo-2.png' },
  { id: 'portrait-03', label: '绿色数据分析师', url: '/employee-photos/employee-photo-3.png' },
  { id: 'portrait-04', label: '蓝色项目经理', url: '/employee-photos/employee-photo-4.png' },
  { id: 'portrait-05', label: '绿色技术顾问', url: '/employee-photos/employee-photo-5.png' },
];

function hashText(input: string) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

export function fallbackEmployeePhoto(seed: string | number | undefined | null) {
  const key = seed == null ? 'openatlas' : String(seed);
  return EMPLOYEE_PHOTO_OPTIONS[hashText(key) % EMPLOYEE_PHOTO_OPTIONS.length];
}

export function employeePhotoVariant(seed: string | number | undefined | null) {
  const key = seed == null ? 'openatlas' : String(seed);
  return hashText(`${key}:photo-variant`) % 8;
}

export function resolveEmployeeCardImage(employee: Partial<Employee>) {
  return employee.card_image_url || employee.visual_profile?.card_image_url || fallbackEmployeePhoto(employee.__id || employee.id || employee.name).url;
}

export function resolveEmployeeAvatarImage(employee: Partial<Employee>) {
  return employee.avatar_image_url || employee.visual_profile?.avatar_image_url || resolveEmployeeCardImage(employee);
}
