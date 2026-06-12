class KimiClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseURL = 'https://api.moonshot.cn/v1';
  }

  async chat(messages, options = {}) {
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: options.model || 'moonshot-v1-8k',
        messages: messages,
        temperature: options.temperature || 0.7,
        max_tokens: options.max_tokens || 2000
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return await response.json();
  }

  // Helper for inventory insights
  async analyzeInventory(inventoryData) {
    const messages = [
      {
        role: 'system',
        content: 'You are an inventory management assistant. Analyze the data and provide actionable insights.'
      },
      {
        role: 'user',
        content: `Analyze this inventory data and suggest reorder points, overstock alerts, and trends:\n${JSON.stringify(inventoryData, null, 2)}`
      }
    ];

    return this.chat(messages);
  }

  // Helper for natural language queries
  async queryInventory(naturalLanguageQuery, inventoryContext) {
    const messages = [
      {
        role: 'system',
        content: `You have access to this inventory system context: ${JSON.stringify(inventoryContext)}. Answer questions about stock, orders, and operations.`
      },
      {
        role: 'user',
        content: naturalLanguageQuery
      }
    ];

    return this.chat(messages);
  }
}

// Usage example:
// const kimi = new KimiClient('your-api-key');
// const insights = await kimi.analyzeInventory(yourInventoryData);
