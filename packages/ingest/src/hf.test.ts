import { describe, expect, it } from 'vitest';
import { detectColumns, parseDatasetId, rowToJd } from './hf';

describe('hugging face import', () => {
  it('accepts dataset links and ids only', () => {
    expect(parseDatasetId('https://huggingface.co/datasets/dinhieufam/VietJobs?utm_source=chatgpt.com')).toBe('dinhieufam/VietJobs');
    expect(parseDatasetId('tinixai/vietnamese-job-descriptions')).toBe('tinixai/vietnamese-job-descriptions');
    for (const bad of ['https://evil.example/datasets/a/b', 'https://huggingface.co/a/b', 'http://127.0.0.1/x', 'a/b/../../c']) expect(() => parseDatasetId(bad)).toThrow();
  });
  it('maps both known schemas to a JD', () => {
    const a = detectColumns(['job_title', 'location', 'qualifications', 'technical_skills', 'soft_skills', 'description', 'requirements_text', 'salary', 'benefits']);
    expect(a.title).toBe('job_title');
    expect(a.body.map((b) => b.column)).toEqual(['description', 'requirements_text', 'qualifications', 'technical_skills', 'soft_skills']);
    const b = detectColumns(['id', 'job_title', 'company_name', 'job_position', 'job_description', 'benefits', 'requirements', 'experience_level']);
    expect(b.org).toBe('company_name');
    const jd = rowToJd({ job_title: 'Product Owner', company_name: 'Công ty A', job_description: 'Quản lý backlog', requirements: 'N/A', experience_level: '2 năm', benefits: 'Thưởng' }, b);
    expect(jd.text).toBe('Mô tả công việc: Product Owner — Công ty A\n\nMô tả công việc:\nQuản lý backlog\n\nKinh nghiệm:\n2 năm');
    expect(jd.text).not.toContain('Thưởng');
  });
  it('rejects datasets without a title or description column', () => {
    expect(() => detectColumns(['text', 'label'])).toThrow();
  });
});
