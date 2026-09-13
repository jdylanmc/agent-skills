import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXIT_ACCEPTED,
  EXIT_FINDINGS,
  GherkinDesignError,
  exitCodeFor,
  reviewGherkin,
} from './gherkin-design.mjs';

const WELL_FORMED = [
  'Feature: Refunding an order',
  '',
  '  Rule: A delivered order can be refunded inside the refund window',
  '',
  '    @id:refund-inside-window',
  '    Scenario: A shopper refunds a delivered order inside the window',
  '      Given a shopper has a delivered order from yesterday',
  '      When the shopper requests a refund for that order',
  '      Then the refund is granted',
  '      And the shopper is told the money is on its way',
  '',
  '    @id:refund-window-closes',
  '    Scenario Outline: The refund window closes after the stated period',
  '      Given a shopper has a delivered order from <age>',
  '      When the shopper requests a refund for that order',
  '      Then the refund is <outcome>',
  '',
  '      Examples:',
  '        | age         | outcome |',
  '        | 29 days ago | granted |',
  '        | 31 days ago | refused |',
].join('\n');

function codes(report) {
  return report.findings.map((entry) => entry.code).sort();
}

function scenario(identity, name, steps) {
  return ['', `  @id:${identity}`, `  Scenario: ${name}`, ...steps.map((step) => `    ${step}`)].join('\n');
}

function feature(...scenarios) {
  return ['Feature: Checkout', ...scenarios].join('\n');
}

test('a well-formed feature in domain language passes review', () => {
  const report = reviewGherkin({ feature: WELL_FORMED, locator: 'refund.feature' });

  assert.equal(report.status, 'clean');
  assert.deepEqual(report.findings, []);
  assert.equal(report.locator, 'refund.feature');
  assert.equal(report.feature, 'Refunding an order');
  assert.equal(report.scenarioCount, 2);
  assert.deepEqual(
    report.scenarios.map((entry) => entry.identity),
    ['refund-inside-window', 'refund-window-closes'],
  );
  assert.deepEqual(
    report.scenarios.map((entry) => entry.rule),
    ['A delivered order can be refunded inside the refund window', 'A delivered order can be refunded inside the refund window'],
  );
});

test('a clean review still reports executable coverage as unproven', () => {
  const report = reviewGherkin({ feature: WELL_FORMED });

  assert.equal(report.status, 'clean');
  assert.equal(report.coverage.executable, 'unknown');
  assert.match(report.coverage.reason, /proven only by executing it/);
  assert.match(report.coverage.missingScenarios, /traceability reconciliation/);
});

test('a scenario without an action or an outcome is reported as unfinished', () => {
  const report = reviewGherkin({
    feature: feature(
      scenario('cart-reached', 'A shopper reaches the cart', ['Given a shopper has one item in the cart']),
    ),
  });

  assert.equal(report.status, 'findings');
  assert.deepEqual(codes(report), ['missing-then', 'missing-when']);
});

test('a scenario driving two actions is reported as broader than one example', () => {
  const report = reviewGherkin({
    feature: feature(
      scenario('checks-out-twice', 'A shopper checks out twice', [
        'Given a shopper has one item in the cart',
        'When the shopper places the order',
        'When the shopper places the order again',
        'Then the shopper has two orders',
      ]),
    ),
  });

  assert.deepEqual(codes(report), ['multiple-when']);
});

test('context stated after the outcome is reported as out of order', () => {
  const report = reviewGherkin({
    feature: feature(
      scenario('places-order', 'A shopper places an order', [
        'When the shopper places the order',
        'Then the order is confirmed',
        'Given the shopper was signed in',
      ]),
    ),
  });

  assert.deepEqual(codes(report), ['out-of-order-steps']);
});

test('a continuation step with nothing to continue is reported', () => {
  const report = reviewGherkin({
    feature: feature(
      scenario('places-order', 'A shopper places an order', [
        'And the shopper was signed in',
        'When the shopper places the order',
        'Then the order is confirmed',
      ]),
    ),
  });

  assert.deepEqual(codes(report), ['unanchored-continuation-step']);
});

test('two scenarios with the same context and action but different outcomes are contradictory', () => {
  const report = reviewGherkin({
    feature: feature(
      scenario('refund-granted', 'A refund is granted', [
        'Given a shopper has a delivered order',
        'When the shopper requests a refund',
        'Then the refund is granted',
      ]),
      scenario('refund-refused', 'A refund is refused', [
        'Given a shopper has a delivered order',
        'When the shopper requests a refund',
        'Then the refund is refused',
      ]),
    ),
  });

  assert.deepEqual(codes(report), ['contradictory-scenarios']);
  assert.match(report.findings[0].detail, /A refund is granted/);
});

test('a repeated example is reported separately from a repeated name', () => {
  const steps = [
    'Given a shopper has a delivered order',
    'When the shopper requests a refund',
    'Then the refund is granted',
  ];
  const report = reviewGherkin({
    feature: feature(
      scenario('refund-granted', 'A refund is granted', steps),
      scenario('refund-granted-again', 'The same refund again', steps),
    ),
  });

  assert.deepEqual(codes(report), ['duplicate-scenario-body']);
});

test('a repeated name is a readability defect when distinct identities disambiguate it', () => {
  const report = reviewGherkin({
    feature: feature(
      scenario('refund-after-delivery', 'A refund is granted', [
        'Given a shopper has a delivered order',
        'When the shopper requests a refund',
        'Then the refund is granted',
      ]),
      scenario('refund-after-collection', 'A refund is granted', [
        'Given a shopper has a collected order',
        'When the shopper requests a refund',
        'Then the refund is granted',
      ]),
    ),
  });

  assert.deepEqual(codes(report), ['duplicate-scenario-name']);
  assert.equal(report.findings[0].severity, 'medium');
  assert.match(report.findings[0].detail, /refund-after-delivery and refund-after-collection/);
});

test('a repeated name with no identity to disambiguate it blocks the reference', () => {
  const report = reviewGherkin({
    feature: [
      'Feature: Checkout',
      '',
      '  Scenario: A refund is granted',
      '    Given a shopper has a delivered order',
      '    When the shopper requests a refund',
      '    Then the refund is granted',
      '',
      '  Scenario: A refund is granted',
      '    Given a shopper has a collected order',
      '    When the shopper requests a refund',
      '    Then the refund is granted',
    ].join('\n'),
  });

  const duplicate = report.findings.find((entry) => entry.code === 'duplicate-scenario-name');
  assert.equal(duplicate.severity, 'high');
  assert.equal(codes(report).filter((code) => code === 'missing-scenario-id').length, 2);
});

test('an unnamed scenario is reported rather than reviewed as clean', () => {
  const report = reviewGherkin({
    feature: [
      'Feature: Checkout',
      '',
      '  @id:places-order',
      '  Scenario:',
      '    Given a shopper has one item in the cart',
      '    When the shopper places the order',
      '    Then the order is confirmed',
    ].join('\n'),
  });

  assert.equal(report.status, 'findings');
  assert.deepEqual(codes(report), ['missing-scenario-name']);
});

test('a scenario declares one durable identity, and a repeated or malformed one is reported', () => {
  const missing = reviewGherkin({
    feature: [
      'Feature: Checkout',
      '',
      '  Scenario: A shopper places an order',
      '    Given a shopper has one item in the cart',
      '    When the shopper places the order',
      '    Then the order is confirmed',
    ].join('\n'),
  });
  const repeated = reviewGherkin({
    feature: feature(
      scenario('places-order', 'A shopper places an order', [
        'Given a shopper has one item in the cart',
        'When the shopper places the order',
        'Then the order is confirmed',
      ]),
      scenario('places-order', 'A shopper places a second order', [
        'Given a shopper has two items in the cart',
        'When the shopper places the order',
        'Then the order is confirmed',
      ]),
    ),
  });
  const malformed = reviewGherkin({
    feature: feature(
      scenario('-refund', 'A shopper places an order', [
        'Given a shopper has one item in the cart',
        'When the shopper places the order',
        'Then the order is confirmed',
      ]),
    ),
  });

  assert.deepEqual(codes(missing), ['missing-scenario-id']);
  assert.equal(missing.scenarios[0].identity, null);
  assert.deepEqual(codes(repeated), ['duplicate-scenario-id']);
  assert.equal(repeated.scenarios[1].identity, null);
  assert.deepEqual(codes(malformed), ['malformed-scenario-id']);
});

test('an identity split by whitespace is refused rather than silently truncated', () => {
  const report = reviewGherkin({
    feature: [
      'Feature: Checkout',
      '',
      '  @id:a shopper',
      '  Scenario: A shopper places an order',
      '    Given a shopper has one item in the cart',
      '    When the shopper places the order',
      '    Then the order is confirmed',
    ].join('\n'),
  });

  assert.equal(report.status, 'parse-failed');
  assert.deepEqual(codes(report), ['malformed-tag-line']);
});

test('two identity tags on one scenario are reported rather than silently ranked', () => {
  const report = reviewGherkin({
    feature: [
      'Feature: Checkout',
      '',
      '  @id:first @id:second',
      '  Scenario: A shopper places an order',
      '    Given a shopper has one item in the cart',
      '    When the shopper places the order',
      '    Then the order is confirmed',
    ].join('\n'),
  });

  assert.deepEqual(codes(report), ['malformed-scenario-id']);
  assert.equal(report.scenarios[0].identity, null);
});

test('ordinary tags are carried without being mistaken for an identity', () => {
  const report = reviewGherkin({
    feature: [
      'Feature: Checkout',
      '',
      '  @slow @refunds',
      '  @id:places-order',
      '  Scenario: A shopper places an order',
      '    Given a shopper has one item in the cart',
      '    When the shopper places the order',
      '    Then the order is confirmed',
    ].join('\n'),
  });

  assert.equal(report.status, 'clean');
  assert.equal(report.scenarios[0].identity, 'places-order');
});

test('a tag above the feature belongs to the feature, not to the first scenario', () => {
  const report = reviewGherkin({
    feature: [
      '@id:whole-feature',
      'Feature: Checkout',
      '',
      '  Scenario: A shopper places an order',
      '    Given a shopper has one item in the cart',
      '    When the shopper places the order',
      '    Then the order is confirmed',
    ].join('\n'),
  });

  assert.equal(report.scenarios[0].identity, null);
  assert.deepEqual(codes(report), ['missing-scenario-id']);
});

test('a tag above an Examples table does not become the next scenario identity', () => {
  const report = reviewGherkin({
    feature: [
      'Feature: Checkout',
      '',
      '  @id:basket-priced',
      '  Scenario Outline: A basket is priced',
      '    Given a basket of <count> items',
      '    When the shopper opens the cart',
      '    Then the total shown is stated',
      '',
      '    @id:the-examples',
      '    Examples:',
      '      | count |',
      '      | 1     |',
      '',
      '  Scenario: A shopper places an order',
      '    Given a shopper has one item in the cart',
      '    When the shopper places the order',
      '    Then the order is confirmed',
    ].join('\n'),
  });

  assert.deepEqual(report.scenarios.map((entry) => entry.identity), ['basket-priced', null]);
  assert.deepEqual(codes(report), ['missing-scenario-id']);
});

test('implementation detail in a step is kept out of the specification', () => {
  const report = reviewGherkin({
    feature: feature(
      scenario('order-stored', 'An order is stored', [
        'Given a row matching [data-testid="total"]',
        'When checkoutService.submit(order) runs',
        'Then the database row is updated',
      ]),
    ),
  });

  assert.deepEqual(codes(report), ['implementation-leak', 'implementation-leak', 'implementation-vocabulary']);
  assert.deepEqual(
    report.findings.filter((entry) => entry.code === 'implementation-leak').map((entry) => entry.severity),
    ['high', 'high'],
  );
});

test('a file name in a sentence is not mistaken for a code invocation', () => {
  const report = reviewGherkin({
    feature: feature(
      scenario('receipt-attached', 'A shopper receives the receipt', [
        'Given a shopper has a confirmed order',
        'When the shopper opens the confirmation message',
        'Then invoice.pdf (attached) is offered for download',
      ]),
    ),
  });

  assert.equal(report.status, 'clean');
});

test('an outcome that cannot be judged true or false is reported as ambiguous', () => {
  const report = reviewGherkin({
    feature: feature(
      scenario('order-priced', 'An order is priced', [
        'Given a shopper has one item in the cart',
        'When the shopper opens the cart',
        'Then the total is calculated correctly',
      ]),
    ),
  });

  assert.deepEqual(codes(report), ['ambiguous-language']);
});

test('a term ending a step is matched despite the punctuation that ends it', () => {
  const report = reviewGherkin({
    feature: feature(
      scenario('order-priced', 'An order is priced', [
        'Given a shopper has one item in the cart',
        'When the shopper opens the cart',
        'Then the total is calculated correctly.',
        'And the database is updated!',
        'And the receipt is emailed (as expected).',
      ]),
    ),
  });

  assert.deepEqual(codes(report), [
    'ambiguous-language',
    'ambiguous-language',
    'implementation-vocabulary',
  ]);
});

test('a term embedded in a longer word is not mistaken for the term', () => {
  const report = reviewGherkin({
    feature: feature(
      scenario('capital-shown', 'A shopper sees the capital city', [
        'Given a shopper has chosen a delivery address',
        'When the shopper opens the address book',
        'Then the capital city is shown beside the postcode',
      ]),
    ),
  });

  assert.equal(report.status, 'clean');
});

test('outline placeholders and example columns must agree', () => {
  const report = reviewGherkin({
    feature: [
      'Feature: Checkout',
      '',
      '  @id:basket-priced',
      '  Scenario Outline: A basket is priced',
      '    Given a basket of <count> items',
      '    When the shopper opens the cart',
      '    Then the total shown is <total>',
      '',
      '    Examples:',
      '      | count | tax |',
      '      | 1     | 0   | 9 |',
    ].join('\n'),
  });

  assert.deepEqual(codes(report), [
    'examples-column-unused',
    'examples-row-width-mismatch',
    'outline-placeholder-unbound',
  ]);
});

test('an outline with no examples cannot be executed', () => {
  const report = reviewGherkin({
    feature: [
      'Feature: Checkout',
      '',
      '  @id:basket-priced',
      '  Scenario Outline: A basket is priced',
      '    Given a basket of <count> items',
      '    When the shopper opens the cart',
      '    Then the total shown is stated',
    ].join('\n'),
  });

  assert.deepEqual(codes(report), ['outline-without-examples']);
});

test('a background supplies context without needing an action, an outcome, or an identity', () => {
  const report = reviewGherkin({
    feature: [
      'Feature: Checkout',
      '',
      '  Background:',
      '    Given the shop is open',
      '',
      '  @id:places-order',
      '  Scenario: A shopper places an order',
      '    Given a shopper has one item in the cart',
      '    When the shopper places the order',
      '    Then the order is confirmed',
    ].join('\n'),
  });

  assert.equal(report.status, 'clean');
  assert.equal(report.scenarioCount, 1);
});

test('text that is not a feature file fails to parse instead of being reviewed', () => {
  const report = reviewGherkin({ feature: 'Scenario: an orphan\n  Given nothing\n' });

  assert.equal(report.status, 'parse-failed');
  assert.deepEqual(codes(report), ['content-before-feature', 'missing-feature', 'step-outside-scenario']);
  assert.equal(report.coverage.executable, 'unknown');
});

test('a feature declaring no scenario proves nothing', () => {
  const report = reviewGherkin({ feature: 'Feature: Checkout\n' });

  assert.deepEqual(codes(report), ['no-scenarios']);
});

test('a doc string is carried as step data rather than parsed as Gherkin', () => {
  const report = reviewGherkin({
    feature: [
      'Feature: Checkout',
      '',
      '  @id:reads-receipt',
      '  Scenario: A shopper reads the receipt',
      '    Given a shopper has a confirmed order',
      '    When the shopper opens the receipt',
      '    Then the receipt reads',
      '      """',
      '      Scenario: this is prose, not a scenario',
      '      """',
    ].join('\n'),
  });

  assert.equal(report.status, 'clean');
  assert.equal(report.scenarioCount, 1);
});

test('a doc string may declare a media type on its opening delimiter', () => {
  for (const mediaType of ['text', 'json', 'application/json', 'text/x-markdown']) {
    const report = reviewGherkin({
      feature: [
        'Feature: Checkout',
        '',
        '  @id:reads-receipt',
        '  Scenario: A shopper reads the receipt',
        '    Given a shopper has a confirmed order',
        '    When the shopper opens the receipt',
        '    Then the receipt reads',
        `      """${mediaType}`,
        '      Thank you for your order',
        '      """',
      ].join('\n'),
    });

    assert.equal(report.status, 'clean', `a ${mediaType} doc string should parse`);
    assert.equal(report.scenarioCount, 1);
  }
});

test('a doc string left open is reported rather than swallowing the rest of the feature', () => {
  const report = reviewGherkin({
    feature: [
      'Feature: Checkout',
      '',
      '  @id:reads-receipt',
      '  Scenario: A shopper reads the receipt',
      '    Given a shopper has a confirmed order',
      '    When the shopper opens the receipt',
      '    Then the receipt reads',
      '      """json',
      '      { "total": 9 }',
    ].join('\n'),
  });

  assert.equal(report.status, 'parse-failed');
  assert.deepEqual(codes(report), ['unterminated-doc-string']);
});

test('descriptions under a feature and a scenario are read as prose, not defects', () => {
  const report = reviewGherkin({
    feature: [
      'Feature: Refunding an order',
      '  Shoppers expect their money back when an order arrives late.',
      '',
      '  @id:refund-late-order',
      '  Scenario: A shopper refunds a late order',
      '    This example covers the ordinary case a support agent sees daily.',
      '',
      '    Given a shopper has a late delivered order',
      '    When the shopper requests a refund for that order',
      '    Then the refund is granted',
    ].join('\n'),
  });

  assert.equal(report.status, 'clean');
  assert.equal(report.scenarioCount, 1);
});

test('prose after a step is unparseable rather than silently dropped', () => {
  const report = reviewGherkin({
    feature: [
      'Feature: Refunding an order',
      '',
      '  @id:refund-late-order',
      '  Scenario: A shopper refunds a late order',
      '    Given a shopper has a late delivered order',
      '    the shopper is impatient',
      '    When the shopper requests a refund for that order',
      '    Then the refund is granted',
    ].join('\n'),
  });

  assert.equal(report.status, 'parse-failed');
  assert.deepEqual(codes(report), ['unrecognized-line']);
});

test('the exit code reports findings rather than disposition', () => {
  assert.equal(exitCodeFor(reviewGherkin({ feature: WELL_FORMED })), EXIT_ACCEPTED);
  assert.equal(exitCodeFor(reviewGherkin({ feature: 'Feature: Checkout\n' })), EXIT_FINDINGS);
  assert.equal(exitCodeFor(reviewGherkin({ feature: 'Given nothing\n' })), EXIT_FINDINGS);
});

test('missing input is refused rather than reviewed as empty', () => {
  assert.throws(() => reviewGherkin({}), (error) => {
    assert.ok(error instanceof GherkinDesignError);
    assert.equal(error.code, 'invalid_input');
    return true;
  });
});

test('a path outside the repository root is refused', () => {
  assert.throws(() => reviewGherkin({ path: '../elsewhere.feature', repositoryRoot: process.cwd() }), (error) => {
    assert.equal(error.code, 'path_outside_root');
    return true;
  });
});
