import { describe, expect, it } from 'vitest';
import { isInfoRequest } from '../../src/detection/keyword-detector';

describe('"ca" style info requests', () => {
  it.each(['ca', 'CA', 'Ca?', 'ca!', 'c.a', 'wen ca', 'wen ca?', 'what is the ca', "what's the ca?", 'whats the CA', 'drop ca', 'drop the ca pls', 'ca pls', 'ca please fam', 'contract', 'contract address', 'Contract Address?', 'send contract address', 'token address', 'can i get the ca', 'need ca', '🚀 ca 🚀', '  CA  '])('matches %s', (t) => {
    expect(isInfoRequest(t)).toBe(true);
  });

  it.each([
    '',
    'cat',
    'cap',
    'california',
    'my ca is 5x',
    'ca is going to the moon',
    'I love this ca-ke recipe',
    'hello everyone',
    'what is the price',
    'address',
    'a contract was signed yesterday with the team and everything',
    'ca ca ca ca ca ca ca ca ca ca ca ca ca ca ca ca ca ca',
  ])('does not match %j', (t) => {
    expect(isInfoRequest(t)).toBe(false);
  });
});
