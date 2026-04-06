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

  const alphaOnly = /^[A-Za-z]+$/.test(token);

  if (alphaOnly && token === token.toUpperCase()) {
    return baseValue.toUpperCase();
  }

  if (alphaOnly && token === token.toLowerCase()) {
    return lowerFirst(baseValue);
  }

  if (alphaOnly) {
    const capitalizedToken = token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    if (token === capitalizedToken) {
      return upperFirst(baseValue);
    }
  }

  return baseValue;
}
