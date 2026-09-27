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
        <select id="country-select">
          <option value="us">United States</option>
          <option value="ca">Canada</option>
        </select>
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

  it('filters scan by search query and presets', () => {
    const searchSnapshot = perceiver.scan({ visibleOnly: false, search: 'Submit' });
    expect(searchSnapshot.elements.length).toBe(1);
    expect(searchSnapshot.elements[0].name).toBe('Submit Form');

    const formsSnapshot = perceiver.scan({ visibleOnly: false, preset: 'forms' });
    expect(formsSnapshot.elements.some((e) => e.tag === 'SELECT')).toBe(true);
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

  it('executes hover action', () => {
    let hovered = false;
    document.getElementById('btn-submit')!.addEventListener('mouseover', () => {
      hovered = true;
    });

    const snapshot = perceiver.scan({ visibleOnly: false });
    const submitEl = snapshot.elements.find((e) => e.name === 'Submit Form')!;

    const result = perceiver.hover(submitEl.id);
    expect(result.success).toBe(true);
    expect(hovered).toBe(true);
  });

  it('executes type action into input elements', () => {
    const snapshot = perceiver.scan({ visibleOnly: false });
    const inputEl = snapshot.elements.find((e) => e.tag === 'INPUT')!;

    const result = perceiver.type(inputEl.id, 'agent-user-42');
    expect(result.success).toBe(true);
    const htmlInput = document.getElementById('user-input') as HTMLInputElement;
    expect(htmlInput.value).toBe('agent-user-42');
  });

  it('executes selectOption on <select> dropdowns', () => {
    const snapshot = perceiver.scan({ visibleOnly: false });
    const selectEl = snapshot.elements.find((e) => e.tag === 'SELECT')!;

    const result = perceiver.selectOption(selectEl.id, 'Canada');
    expect(result.success).toBe(true);
    const htmlSelect = document.getElementById('country-select') as HTMLSelectElement;
    expect(htmlSelect.value).toBe('ca');
  });

  it('executes pressKey with keyboard events', () => {
    let keyPressed = '';
    window.addEventListener('keydown', (e) => {
      keyPressed = e.key;
    });

    const result = perceiver.pressKey('Enter');
    expect(result.success).toBe(true);
    expect(keyPressed).toBe('Enter');
  });

  it('inspects detailed element attributes, styles, and DOM hierarchy', () => {
    const snapshot = perceiver.scan({ visibleOnly: false });
    const submitEl = snapshot.elements.find((e) => e.name === 'Submit Form')!;

    const result = perceiver.inspect(submitEl.id);
    expect(result.success).toBe(true);
    expect(result.inspection).toBeDefined();
    expect(result.inspection!.attributes['aria-label']).toBe('Submit Form');
    expect(result.inspection!.isInteractive).toBe(true);
    expect(result.inspection!.domPath).toContain('button');
  });

  it('evaluates safe JavaScript expressions', () => {
    const result = perceiver.evalScript('1 + 1');
    expect(result.success).toBe(true);
    expect(result.result).toBe(2);
  });

  it('computes DOM diff between snapshots', () => {
    const s1 = perceiver.scan({ visibleOnly: false });
    perceiver.computeDiff(s1);

    // Modify DOM
    const newBtn = document.createElement('button');
    newBtn.id = 'dynamic-btn';
    newBtn.textContent = 'Dynamic Button';
    document.getElementById('app')!.appendChild(newBtn);

    const s2 = perceiver.scan({ visibleOnly: false });
    const diff = perceiver.computeDiff(s2);

    expect(diff.added.some((e) => e.selector.includes('dynamic-btn'))).toBe(true);
  });

  it('handles toggleHUD without throwing', () => {
    expect(perceiver.toggleHUD(true)).toBe(true);
    expect(perceiver.toggleHUD(false)).toBe(false);
  });
});
