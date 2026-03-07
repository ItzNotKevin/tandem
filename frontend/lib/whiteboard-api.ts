import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'

export interface AnalysisResponse {
  hasMistake: boolean
  feedback: string
  mistakeDescription: string
  coordinates?: { x: number; y: number }
}

export async function analyzeWhiteboard(imageBase64: string, questionContext: string): Promise<AnalysisResponse> {
  try {
    const response = await axios.post(`${API_URL}/whiteboard/analyze`, {
      imageBase64,
      questionContext,
      timestamp: Date.now()
    })
    return response.data
  } catch (error) {
    console.error('Error analyzing whiteboard:', error)
    return {
      hasMistake: false,
      feedback: 'Could not reach the analysis server. Please try again.',
      mistakeDescription: 'Connection error'
    }
  }
}
