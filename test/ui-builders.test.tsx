/* @vitest-environment jsdom */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import AgentsPage from '../src/pages/AgentsPage';
import CrewsPage from '../src/pages/CrewsPage';

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: any) => <>{children}</>,
  motion: new Proxy(
    {},
    {
      get: () => ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
    }
  ),
}));

function mockJson(data: any, status = 200) {
  const payload = JSON.stringify(data);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    text: async () => payload,
    json: async () => data,
  } as any;
}

describe.sequential('builder UI behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    if (typeof Element !== 'undefined' && !(Element.prototype as any).scrollIntoView) {
      (Element.prototype as any).scrollIntoView = () => {};
    }
    // Some test runners/polyfills expose localStorage without clear().
    if (typeof localStorage?.clear === 'function') {
      localStorage.clear();
      return;
    }
    if (typeof localStorage?.removeItem === 'function') {
      localStorage.removeItem('layout_sidebar_collapsed');
      localStorage.removeItem('layout_sidebar_hidden');
      localStorage.removeItem('selected_project_id');
    }
  });

  it('agent builder keeps system prompt visible and optional fields behind Add Configuration', async () => {
    let postedAgentPayload: any = null;
    const existingAgent = {
      id: 77,
      name: 'Existing Agent',
      role: 'Researcher',
      goal: '',
      backstory: '',
      system_prompt: '',
      model: 'gemini-3-flash-preview',
      provider: 'google',
      temperature: null,
      max_tokens: null,
      memory_window: null,
      max_iterations: null,
      tools_enabled: true,
      retry_policy: 'standard',
      timeout_ms: null,
      is_exposed: 0,
      project_id: null,
      running_count: 0,
      status: 'idle',
      stats: null,
      tools: [],
      mcp_tool_ids: [],
      mcp_bundle_ids: [],
    };

    const fetchMock = vi.fn(async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : String(input?.url || input);
      const method = String(init?.method || 'GET').toUpperCase();

      if (url === '/api/agents' && method === 'GET') return mockJson([existingAgent]);
      if (url === '/api/tools' && method === 'GET') return mockJson([]);
      if (url === '/api/mcp/exposed-tools' && method === 'GET') return mockJson([]);
      if (url === '/api/mcp/bundles' && method === 'GET') return mockJson([]);
      if (url === '/api/projects' && method === 'GET') return mockJson([]);
      if (url === '/api/providers' && method === 'GET') return mockJson([{ id: 'google', name: 'Google', provider: 'google' }]);
      if (url === '/api/providers/google/models' && method === 'GET') return mockJson([{ id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview' }]);
      if (url === '/api/agents/77' && method === 'PUT') {
        postedAgentPayload = JSON.parse(String(init?.body || '{}'));
        return mockJson({ id: 101 });
      }
      return mockJson({});
    });
    vi.stubGlobal('fetch', fetchMock as any);

    render(
      <MemoryRouter>
        <AgentsPage />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByTitle('Edit'));
    expect(await screen.findByRole('heading', { name: /Edit AI Specialist/i })).toBeInTheDocument();

    // System Prompt must always be visible.
    const systemPrompt = screen.getByPlaceholderText(
      'Optional. If empty, a default prompt is built from name/role and safe defaults.'
    );
    expect(systemPrompt).toBeInTheDocument();

    // Optional fields should be hidden until explicitly added.
    expect(screen.queryByPlaceholderText('What is this agent trying to achieve?')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Give the agent some personality and context...')).not.toBeInTheDocument();

    // Add Goal from Add Configuration dropdown.
    const optionalSelect = screen.getByDisplayValue('Choose optional field...');
    await userEvent.selectOptions(optionalSelect, 'goal');
    const goalInput = screen.getByPlaceholderText('What is this agent trying to achieve?');
    expect(goalInput).toBeInTheDocument();

    // Submit with minimal visible required fields.
    const nameInput = screen.getByPlaceholderText('e.g. Research Analyst');
    const roleInput = screen.getByPlaceholderText('e.g. Senior Researcher');
    await userEvent.clear(nameInput);
    await userEvent.clear(roleInput);
    await userEvent.type(nameInput, 'UI Agent');
    await userEvent.type(roleInput, 'Reviewer');
    await userEvent.type(systemPrompt, 'You are a deterministic test agent.');
    await userEvent.type(goalInput, 'Validate forms.');
    await userEvent.click(screen.getByRole('button', { name: /Update Specialist/i }));

    await waitFor(() => {
      expect(postedAgentPayload).toBeTruthy();
    });
    expect(postedAgentPayload.name).toBe('UI Agent');
    expect(postedAgentPayload.role).toBe('Reviewer');
    expect(postedAgentPayload.system_prompt).toContain('deterministic');
  });

  it('crew builder keeps optional sections behind Add Configuration and submits selected agents', async () => {
    let postedCrewPayload: any = null;

    const fetchMock = vi.fn(async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : String(input?.url || input);
      const method = String(init?.method || 'GET').toUpperCase();

      if (url === '/api/crews' && method === 'GET') return mockJson([]);
      if (url === '/api/agents' && method === 'GET') return mockJson([{ id: 1, name: 'Crew Agent', role: 'Executor' }]);
      if (url === '/api/projects' && method === 'GET') return mockJson([]);
      if (url === '/api/providers' && method === 'GET') return mockJson([]);
      if (url === '/api/crews' && method === 'POST') {
        postedCrewPayload = JSON.parse(String(init?.body || '{}'));
        return mockJson({ id: 201 });
      }
      return mockJson({});
    });
    vi.stubGlobal('fetch', fetchMock as any);

    render(
      <MemoryRouter>
        <CrewsPage />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole('button', { name: /Architect New Crew/i }));
    expect(await screen.findByRole('heading', { name: /Initialize Syndicate/i })).toBeInTheDocument();

    // Optional section hidden by default.
    expect(screen.queryByPlaceholderText('Describe the collaborative objective of this crew...')).not.toBeInTheDocument();

    // Add description section from optional config dropdown.
    const optionalSelect = screen.getByDisplayValue('Choose optional section...');
    await userEvent.selectOptions(optionalSelect, 'description');
    const briefInput = screen.getByPlaceholderText('Describe the collaborative objective of this crew...');
    expect(briefInput).toBeInTheDocument();

    const crewNameInput = screen.getByPlaceholderText('e.g. Strategic Analyst Pod');
    fireEvent.change(crewNameInput, { target: { value: 'UI Crew' } });
    await waitFor(() => expect((crewNameInput as HTMLInputElement).value).toBe('UI Crew'));
    fireEvent.change(briefInput, { target: { value: 'UI crew objective' } });
    await userEvent.click(screen.getByRole('button', { name: /Crew Agent/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Initialize Syndicate$/i }));

    await waitFor(() => {
      expect(postedCrewPayload).toBeTruthy();
    });
    expect(postedCrewPayload.name).toBe('UI Crew');
    expect(postedCrewPayload.agentIds).toContain(1);
  });
});
