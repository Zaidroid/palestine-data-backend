# Contributing to Palestine Data Backend

Thank you for your interest in contributing! This document provides guidelines for contributing to the project.

## Ways to Contribute

### 1. Code Contributions
- Add new data sources
- Improve data transformations
- Enhance validation logic
- Fix bugs
- Optimize performance

### 2. Data Contributions
- Validate existing data
- Suggest new data sources
- Report data quality issues
- Provide historical data

### 3. Documentation
- Improve guides
- Add examples
- Fix typos
- Translate content

### 4. Testing
- Test data fetchers
- Validate transformations
- Report bugs
- Suggest improvements

## Getting Started

### 1. Fork the Repository

```bash
# Fork on GitHub, then clone
git clone https://github.com/YOUR_USERNAME/palestine-data-backend.git
cd palestine-data-backend
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-fix
```

### 4. Make Changes

- Follow existing code style
- Add tests for new features
- Update documentation
- Test thoroughly

### 5. Test Your Changes

```bash
# Test data fetching
npm run fetch-worldbank

# Test transformation
npm run populate-unified

# Test validation
npm run validate-data

# Test complete pipeline
npm run update-data
```

### 6. Commit Changes

```bash
git add .
git commit -m "feat: add new data source for XYZ"
# or
git commit -m "fix: resolve validation error in ABC"
```

**Commit Message Format:**
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `test:` Test additions/changes
- `refactor:` Code refactoring
- `perf:` Performance improvements
- `chore:` Maintenance tasks

### 7. Push and Create Pull Request

```bash
git push origin feature/your-feature-name
```

Then create a Pull Request on GitHub.

## Code Style

### JavaScript
- Use ES6+ features
- Use `const` and `let`, not `var`
- Use async/await for async operations
- Add JSDoc comments for functions
- Follow existing patterns

### Example:
```javascript
/**
 * Fetch data from World Bank API
 * @param {string} indicator - Indicator code
 * @param {string} country - Country code
 * @returns {Promise<Object>} Fetched data
 */
async function fetchWorldBankData(indicator, country) {
  try {
    const response = await fetch(`https://api.worldbank.org/v2/country/${country}/indicator/${indicator}?format=json`);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`Error fetching ${indicator}:`, error);
    throw error;
  }
}
```

## Adding a New Data Source

### 1. Create Fetcher Script

Create `scripts/fetch-newsource-data.js`:

```javascript
import fs from 'fs';
import path from 'path';

const DATA_DIR = './data/sources/newsource';

async function fetchNewSourceData() {
  console.log('Fetching data from New Source...');
  
  // Create directory
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  
  try {
    // Fetch data
    const response = await fetch('https://api.newsource.org/data');
    const data = await response.json();
    
    // Save data
    fs.writeFileSync(
      path.join(DATA_DIR, 'data.json'),
      JSON.stringify(data, null, 2)
    );
    
    console.log('✓ New Source data fetched successfully');
  } catch (error) {
    console.error('✗ Error fetching New Source data:', error);
  }
}

fetchNewSourceData();
```

### 2. Add to fetch-all-data.js

```javascript
// Add to scripts/fetch-all-data.js
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function fetchAllData() {
  // ... existing code ...
  
  // Add new source
  await runScript('fetch-newsource-data.js', 'New Source');
}
```

### 3. Create Transformer

Create `scripts/utils/newsource-transformer.js`:

```javascript
export function transformNewSourceData(rawData) {
  return rawData.map(item => ({
    id: item.id,
    date: item.date,
    value: item.value,
    // ... transform to unified format
  }));
}
```

### 4. Add to populate-unified-data.js

```javascript
// Add to scripts/populate-unified-data.js
import { transformNewSourceData } from './utils/newsource-transformer.js';

// In main function
const newSourceData = JSON.parse(
  fs.readFileSync('./data/sources/newsource/data.json')
);
const transformedData = transformNewSourceData(newSourceData);
```

### 5. Update package.json

```json
{
  "scripts": {
    "fetch-newsource": "node scripts/fetch-newsource-data.js"
  }
}
```

### 6. Add Documentation

Update `docs/DATA_SOURCES_SUMMARY.md` with new source information.

### 7. Test

```bash
npm run fetch-newsource
npm run populate-unified
npm run validate-data
```

## Testing Guidelines

### Unit Tests
- Test individual functions
- Mock external dependencies
- Cover edge cases

### Integration Tests
- Test complete workflows
- Test data transformations
- Validate output format

### Example Test:
```javascript
// scripts/test-newsource.js
import { transformNewSourceData } from './utils/newsource-transformer.js';

const sampleData = [
  { id: 1, date: '2024-01-01', value: 100 }
];

const result = transformNewSourceData(sampleData);

console.assert(result.length === 1, 'Should transform one item');
console.assert(result[0].id === 1, 'Should preserve ID');
console.log('✓ All tests passed');
```

## Documentation Guidelines

### README Files
- Clear and concise
- Include examples
- Explain purpose
- List requirements

### Code Comments
- Explain why, not what
- Document complex logic
- Add JSDoc for functions

### Guides
- Step-by-step instructions
- Include code examples
- Add troubleshooting section

## Pull Request Process

### 1. Ensure Tests Pass
```bash
npm run test-pipeline
npm run validate-data
```

### 2. Update Documentation
- Update README if needed
- Add/update guides
- Update CHANGELOG.md

### 3. Create Pull Request
- Clear title and description
- Reference related issues
- List changes made
- Add screenshots if applicable

### 4. Code Review
- Address review comments
- Make requested changes
- Keep discussion professional

### 5. Merge
- Squash commits if needed
- Update branch if needed
- Celebrate! 🎉

## Code of Conduct

### Be Respectful
- Treat everyone with respect
- Be constructive in feedback
- Welcome newcomers

### Be Professional
- Keep discussions on-topic
- Avoid personal attacks
- Focus on the code, not the person

### Be Collaborative
- Help others learn
- Share knowledge
- Work together

## Questions?

- **Documentation**: Check `docs/` directory
- **Issues**: Open a GitHub issue
- **Discussions**: Use GitHub Discussions
- **Email**: [Contact email]

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to Palestine Data Backend! 🇵🇸
