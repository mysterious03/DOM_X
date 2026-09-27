import { describe, it, expect, beforeEach } from 'vitest';
import { DOMAgentPerceiver } from '../src/core/agent-dom';

describe('DOMAgentPerceiver & AI Action Layer', () => {
  let perceiver: DOMAgentPerceiver;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="app">
        <h1>Dashboard</h1>
        <button id="btn-submit" aria-label="Submit Form">Submit</button>
        <button id="btn-cancel" disabled>Cancel</button>
        <input id="user-input" type="text" placeholder="Enter username" />
        <a id="home-link" href="https://example.com">Home</a>
        <div role="alert" id="status-toast" style="display:none">Success</div>
      </div>
    `;
    perceiver = new DOMAgentPerceiver();
  });

  it('scans DOM and extracts interactive elements with @eX reference IDs', () => {
    const snapshot = perceiver.scan({ visibleOnly: false });

    expect(snapshot.totalElements).toBeGreaterThanOrEqual(4);
    expect(snapshot.elements.some((e) => e.name === 'Submit Form')).toBe(true);
    expect(snapshot.elements.some((e) => e.disabled === true)).toBe(true);
    expect(snapshot.elements.some((e) => e.tag === 'INPUT')).toBe(true);
    expect(snapshot.formattedSummary).toContain('@e1');
  });

  it('executes click action and triggers event listeners', () => {
    let clicked = false;
    document.getElementById('btn-submit')!.addEventListener('click', () => {
      clicked = true;
    });

    const snapshot = perceiver.scan({ visibleOnly: false });
    const submitEl = snapshot.elements.find((e) => e.name === 'Submit Form')!;

    const result = perceiver.click(submitEl.id);
    expect(result.success).toBe(true);
    expect(clicked).toBe(true);
  });

  it('executes type action into input elements', () => {
    const snapshot = perceiver.scan({ visibleOnly: false });
    const inputEl = snapshot.elements.find((e) => e.tag === 'INPUT')!;

    const result = perceiver.type(inputEl.id, 'agent-user-42');
    expect(result.success).toBe(true);
    const htmlInput = document.getElementById('user-input') as HTMLInputElement;
    expect(htmlInput.value).toBe('agent-user-42');
  });

  it('handles toggleHUD without throwing', () => {
    expect(perceiver.toggleHUD(true)).toBe(true);
    expect(perceiver.toggleHUD(false)).toBe(false);
  });
});
