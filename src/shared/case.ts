export function lowerFirst(value: string): string {
  if (!value) {
    return value;
  }

  return value.charAt(0).toLowerCase() + value.slice(1);
}

export function upperFirst(value: string): string {
  if (!value) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function applyCaseToValue(token: string, baseValue: string): string {
  if (!baseValue) {
    return baseValue;
  }

  if (token === token.toUpperCase()) {
    return baseValue.toUpperCase();
  }

  if (token === token.toLowerCase()) {
    return lowerFirst(baseValue);
  }

  const capitalizedToken = token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
  if (token === capitalizedToken) {
    return upperFirst(baseValue);
  }

  return baseValue;
}
