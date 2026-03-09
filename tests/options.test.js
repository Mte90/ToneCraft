/**
 * Tests for options/storage module
 * Mocks browser.storage.local for unit testing
 */

// Mock browser.storage.local
const mockStorage = {
  _data: {},
  get: jest.fn(),
  set: jest.fn(),
};

// Create browser global for Firefox API
const browser = {
  storage: {
    local: mockStorage,
  },
};

// Create chrome global for Chrome API (fallback)
const chrome = {
  storage: {
    local: mockStorage,
  },
};

// Set globals before requiring module
global.browser = browser;
global.chrome = chrome;

// Import the module under test
const { loadSettings, saveSettings } = require('./options');

describe('Storage Module', () => {
  beforeEach(() => {
    // Clear mock state before each test
    mockStorage._data = {};
    mockStorage.get.mockClear();
    mockStorage.set.mockClear();
    
    // Default get to return empty object
    mockStorage.get.mockImplementation((defaults) => {
      const result = { ...defaults };
      for (const key in mockStorage._data) {
        result[key] = mockStorage._data[key];
      }
      return Promise.resolve(result);
    });
    
    mockStorage.set.mockImplementation((data) => {
      Object.assign(mockStorage._data, data);
      return Promise.resolve();
    });
  });

  describe('loadSettings', () => {
    test('should load settings from storage', async () => {
      // Arrange: Set up mock storage with data
      mockStorage._data = {
        apiKey: 'test-key-123',
        aiHost: 'https://api.example.com',
        modelName: 'gpt-4',
        customPrompt: 'You are a helpful assistant.',
      };

      // Act
      const result = await loadSettings();

      // Assert
      expect(result.apiKey).toBe('test-key-123');
      expect(result.aiHost).toBe('https://api.example.com');
      expect(result.modelName).toBe('gpt-4');
      expect(result.customPrompt).toBe('You are a helpful assistant.');
      expect(mockStorage.get).toHaveBeenCalled();
    });

    test('should handle empty storage (default to empty strings)', async () => {
      // Arrange: Empty storage
      mockStorage._data = {};

      // Act
      const result = await loadSettings();

      // Assert
      expect(result.apiKey).toBe('');
      expect(result.aiHost).toBe('');
      expect(result.modelName).toBe('');
      expect(result.customPrompt).toBe('');
    });

    test('should handle storage errors', async () => {
      // Arrange: Mock error
      mockStorage.get.mockRejectedValue(new Error('Storage unavailable'));

      // Act & Assert
      await expect(loadSettings).rejects.toThrow('Error loading settings: Storage unavailable');
    });
  });

  describe('saveSettings', () => {
    test('should save settings to storage', async () => {
      // Arrange
      const settings = {
        apiKey: 'test-key-456',
        aiHost: 'https://api.test.com',
        modelName: 'gpt-3.5-turbo',
        customPrompt: 'Act as a developer.',
      };

      // Act
      await saveSettings(settings);

      // Assert
      expect(mockStorage.set).toHaveBeenCalledWith(settings);
      expect(mockStorage._data.apiKey).toBe('test-key-456');
      expect(mockStorage._data.aiHost).toBe('https://api.test.com');
      expect(mockStorage._data.modelName).toBe('gpt-3.5-turbo');
      expect(mockStorage._data.customPrompt).toBe('Act as a developer.');
    });

    test('should handle partial settings', async () => {
      // Arrange
      const settings = {
        apiKey: 'some-key',
        // Other fields not provided
      };

      // Act
      await saveSettings(settings);

      // Assert
      expect(mockStorage.set).toHaveBeenCalledWith(settings);
      expect(mockStorage._data.apiKey).toBe('some-key');
    });

    test('should handle storage errors', async () => {
      // Arrange: Mock error
      mockStorage.set.mockRejectedValue(new Error('Storage write failed'));

      // Act & Assert
      await expect(saveSettings({ apiKey: 'test' })).rejects.toThrow('Error saving settings: Storage write failed');
    });
  });
});
